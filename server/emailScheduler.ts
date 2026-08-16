import type { User } from "@shared/schema";

import { type MissedWorkoutData, sendMafTestReminder,sendMissedWorkoutReminder, sendWeeklySummary, type WeeklySummaryData } from "./email";
import { logger } from "./logger";
import { type PushPayload,sendPushToUser } from "./pushNotifications";
import { sendJobNoRetry } from "./queue";
import { calculateStreak } from "./routeUtils";
import { calculatePersonalRecords, countPersonalRecordsInRange } from "./services/analyticsService";
import { getLocalMondayWeekBoundaries } from "./services/weeklyProgress";
import type { IStorage } from "./storage";
import { addDaysLocal, getLocalDateStr, getLocalDayOfWeek } from "./timezone";

// Claim windows for the send ledgers. Both are shorter than their nominal
// cadence on purpose: the stamp now lands when the claim is taken rather than
// after the send, so a full-cadence window would put each tick a few seconds
// inside the previous one's and skip it — the mechanism that turned the weekly
// summary fortnightly. The upstream gates (athlete-local Monday for the
// summary, one scan per day for the reminder) are what set the real cadence;
// these only have to stop a second send on the same local day.
const WEEKLY_CLAIM_WINDOW_MS = 6 * 24 * 60 * 60 * 1000;
const MISSED_CLAIM_WINDOW_MS = 20 * 60 * 60 * 1000;

export async function processWeeklySummary(storage: IStorage, user: User, now: Date): Promise<boolean> {
  // Re-fetch the user so an opt-out that happened between enqueue and this
  // worker run is respected (W4 — race between cron scan and job execution).
  const fresh = await storage.users.getUser(user.id);
  if (!fresh?.email || !wantsEmail(fresh, "weeklySummary")) return false;
  user = fresh;

  // All day-of-week and "this week" math runs in the athlete's local time
  // (C10). The daily cron still fires once a day in UTC, but each user's
  // Monday is detected against THEIR userTimezone, so a Sydney user gets
  // Monday morning local and a Hawaii user gets Monday evening local
  // instead of either always firing or never firing depending on tz.
  const tz = user.userTimezone;
  if (getLocalDayOfWeek(now, tz) !== 1) return false;

  // Claim BEFORE sending, atomically. The day-of-week gate above is what makes
  // this weekly; the claim only has to stop a second send within the same local
  // day, so its window is deliberately shorter than the cadence (see
  // claimWeeklySummary).
  const claimed = await storage.users.claimWeeklySummary(
    user.id,
    new Date(now.getTime() - WEEKLY_CLAIM_WINDOW_MS),
    now,
  );
  if (!claimed) return false;

  // "Last week" = the most recently completed Monday→Sunday week in the user's
  // local tz. Identical to the seven days ending yesterday that this used to
  // compute inline, because the gate above only lets us get here on a local
  // Monday — but stated as a week rather than as a trailing window, and shared
  // with every other weekly surface so they cannot drift apart.
  const { previous } = getLocalMondayWeekBoundaries(now, tz);
  const weekStartStr = previous.weekStart;
  const weekEndStr = previous.weekEnd;

  const [stats, timeline, allSets] = await Promise.all([
    storage.analytics.getWeeklyStats(user.id, weekStartStr, weekEndStr),
    storage.timeline.getTimeline(user.id),
    storage.analytics.getAllExerciseSetsWithDates(user.id),
  ]);
  const completedDates = new Set(
    timeline
      .filter(e => e.status === "completed" && e.date)
      .map(e => e.date)
  );
  const streak = calculateStreak(completedDates, tz);
  // "PRs This Week" = all-time bests first achieved within last week's window
  // (W18). Computed over the user's full history so only true records count.
  const prsThisWeek = countPersonalRecordsInRange(
    calculatePersonalRecords(allSets),
    weekStartStr,
    weekEndStr,
  );

  const total = stats.completedCount + stats.missedCount + stats.skippedCount;
  const summaryData: WeeklySummaryData = {
    completedCount: stats.completedCount,
    plannedCount: stats.plannedCount,
    missedCount: stats.missedCount,
    skippedCount: stats.skippedCount,
    completionRate: total > 0 ? Math.round((stats.completedCount / total) * 100) : 0,
    currentStreak: streak,
    prsThisWeek,
    totalDuration: stats.totalDuration,
    weekStartDate: weekStartStr,
    weekEndDate: weekEndStr,
  };

  // The claim is already recorded; a failed send costs this athlete the week
  // rather than risking a duplicate. The email queues are no-retry anyway
  // (queue.ts), so a failure was never going to be retried.
  const sent = await sendWeeklySummary(user, summaryData);

  // Also send push notification (fire-and-forget)
  void sendPushToUser(user.id, {
    title: "Weekly Training Summary",
    body: `You completed ${summaryData.completedCount} workouts this week (${summaryData.completionRate}% completion rate).`,
    // The review of THIS week, not /analytics — which shows a different set of
    // numbers over a different window than the notification just quoted.
    url: `/review?week=${encodeURIComponent(weekStartStr)}`,
  });

  return sent;
}

export async function processMissedWorkoutReminder(storage: IStorage, user: User, now: Date): Promise<boolean> {
  // See W4 — re-check preferences at send time.
  const fresh = await storage.users.getUser(user.id);
  if (!fresh?.email || !wantsEmail(fresh, "missedReminder")) return false;
  user = fresh;


  // "Yesterday" is the calendar date one day before today *in the user's
  // local tz* (C10). A Pacific user checked at 02:00 UTC is still on the
  // previous day locally; using server UTC here would skip their reminder.
  const todayStr = getLocalDateStr(now, user.userTimezone);
  const yesterdayStr = addDaysLocal(todayStr, -1);
  const missed = await storage.analytics.getMissedWorkoutsForDate(user.id, yesterdayStr);
  if (missed.length === 0) return false;

  // Claimed only once there is something to send, so a quiet day does not burn
  // the day's slot (the old guard had the same property by never stamping).
  const claimed = await storage.users.claimMissedReminder(
    user.id,
    new Date(now.getTime() - MISSED_CLAIM_WINDOW_MS),
    now,
  );
  if (!claimed) return false;

  const missedData: MissedWorkoutData[] = missed.map(m => ({
    planDayId: m.planDayId,
    date: m.date,
    focus: m.focus,
    mainWorkout: m.mainWorkout,
    planName: m.planName,
  }));
  const sent = await sendMissedWorkoutReminder(user, missedData);

  // Also send push notification (fire-and-forget)
  void sendPushToUser(user.id, buildMissedWorkoutPush(missedData));

  return sent;
}

/**
 * The missed-workout push. A single missed session is named in the title and
 * deep-linked, so the tap lands on that session's log surface — `?workout=`
 * carries the raw `plan_days.id`, which `useTimelineSurfaceSelection` matches
 * and routes to the LogSheet. With more than one there is no single day to open,
 * so it falls back to the timeline root.
 *
 * Copy is deliberately an invitation rather than a reprimand: the athlete who
 * gets this has already missed the session, and the useful thing to offer is the
 * next action, not the verdict.
 */
export function buildMissedWorkoutPush(missed: MissedWorkoutData[]): PushPayload {
  const [first] = missed;
  if (missed.length === 1 && first) {
    return {
      title: `Missed: ${first.focus}`,
      body: "Still worth doing — log it, or move it to a day that works.",
      url: `/?workout=${encodeURIComponent(first.planDayId)}`,
    };
  }

  return {
    title: `${missed.length} missed sessions`,
    body: `${missed.map(m => m.focus).join(", ")} — log them or move them to a day that works.`,
    url: "/",
  };
}

export async function processMafTestReminder(storage: IStorage, user: User, now: Date): Promise<boolean> {
  // Re-fetch so a style switch / reschedule between enqueue and run is honoured
  // (W4 — race between cron scan and job execution).
  const fresh = await storage.users.getUser(user.id);
  if (!fresh) return false;
  user = fresh;

  if (user.trainingStyleId !== "maf_method") return false;

  // Atomically claim the one-shot reminder. The conditional UPDATE clears the
  // schedule only if it is still set and due, and reports whether THIS run won
  // the claim. Two overlapping jobs (or a cron re-tick before the first job
  // finishes) can't both send — only the winner proceeds (Codex P2). A
  // claimed-but-undelivered reminder is forgone rather than risking duplicate
  // spam, since the baseline test is scheduled just once on MAF activation.
  const claimed = await storage.users.claimMafBaselineTest(user.id, now);
  if (!claimed) return false;

  const emailSent = user.emailNotifications ? await sendMafTestReminder(user) : false;

  // Push is fire-and-forget and no-ops when the user has no subscription.
  void sendPushToUser(user.id, {
    title: "Time for your MAF test",
    body: "Run a fixed distance or time at your MAF heart-rate ceiling, then log the run to track your aerobic progress.",
    url: "/log",
  });

  return emailSent;
}

function wantsEmail(user: User, kind: "weeklySummary" | "missedReminder"): boolean {
  if (!user.emailNotifications) return false;
  if (kind === "weeklySummary") return user.emailWeeklySummary === true;
  return user.emailMissedReminder === true;
}

export async function checkAndSendEmailsForUser(storage: IStorage, user: User): Promise<string[]> {
  const sent: string[] = [];
  if (!user.email || !user.emailNotifications) return sent;

  const now = new Date();

  if (wantsEmail(user, "weeklySummary") && await processWeeklySummary(storage, user, now)) {
    sent.push("weekly_summary");
  }

  if (wantsEmail(user, "missedReminder") && await processMissedWorkoutReminder(storage, user, now)) {
    sent.push("missed_reminder");
  }

  return sent;
}

export async function runEmailCronJob(storage: IStorage): Promise<{ usersChecked: number; emailsSent: number; details: string[] }> {
  const details: string[] = [];

  try {
    const markedMissed = await storage.plans.markMissedPlanDays();
    if (markedMissed > 0) {
      logger.info({ context: "email" }, `Marked ${markedMissed} past planned day(s) as missed`);
    }

    const now = new Date();
    const usersToCheck = await storage.users.getUsersWithEmailNotifications();
    const dueMafUsers = await storage.users.getUsersWithDueMafBaselineTest(now);
    if (usersToCheck.length === 0 && dueMafUsers.length === 0) {
      return { usersChecked: 0, emailsSent: 0, details: ["No users with email notifications or due MAF tests"] };
    }

    // bearer:disable javascript_lang_logger_leak — logs only enqueue counts
    // (integers) and a static context tag; no PII or secrets.
    logger.info({ context: "email" }, `Cron: Enqueuing jobs for ${usersToCheck.length} email user(s) + ${dueMafUsers.length} due MAF test(s)`);

    // Await every enqueue so reported counts reflect what actually made it into
    // the queue (CODEBASE_AUDIT.md §5b). Fire-and-forget would overreport when
    // pg-boss backpressure or DB errors reject some sends.
    type EnqueueMeta = { userId: string; jobName: string };
    const ops: Promise<unknown>[] = [];
    const meta: EnqueueMeta[] = [];
    // Respect per-type email toggles AND per-user timezone when enqueueing.
    // The cron fires daily, so a Hawaii user's Monday (which occurs in
    // UTC-Monday afternoon through UTC-Tuesday morning) is still covered:
    // when the cron fires on UTC-Tuesday, getLocalDayOfWeek resolves to 1
    // for Hawaii but 2 for UTC users — only the Hawaii user gets a
    // weekly-summary job enqueued on that pass (C10).
    for (const user of usersToCheck) {
      const isUserLocalMonday = getLocalDayOfWeek(now, user.userTimezone) === 1;
      if (isUserLocalMonday && wantsEmail(user, "weeklySummary")) {
        ops.push(sendJobNoRetry("send-weekly-summary", { userId: user.id }));
        meta.push({ userId: user.id, jobName: "send-weekly-summary" });
      }
      if (wantsEmail(user, "missedReminder")) {
        ops.push(sendJobNoRetry("send-missed-reminder", { userId: user.id }));
        meta.push({ userId: user.id, jobName: "send-missed-reminder" });
      }
    }

    // MAF baseline-test reminders — a separate scan since due users may be
    // push-only (not in the email-notifications set above).
    for (const user of dueMafUsers) {
      ops.push(sendJobNoRetry("send-maf-test-reminder", { userId: user.id }));
      meta.push({ userId: user.id, jobName: "send-maf-test-reminder" });
    }

    const settled = await Promise.allSettled(ops);
    const fulfilled = settled.filter((r) => r.status === "fulfilled").length;
    const failed = settled.length - fulfilled;

    settled.forEach((result, idx) => {
      if (result.status === "rejected") {
        const info = meta[idx];
        logger.error(
          { context: "email", userId: info.userId, err: result.reason },
          `Failed to enqueue ${info.jobName} job`,
        );
      }
    });

    const detail = `Enqueued ${fulfilled}/${settled.length} job(s) for ${usersToCheck.length} user(s)`;
    details.push(detail);
    if (failed > 0) {
      details.push(`Failed: ${failed}`);
    }
    logger.info({ context: "email" }, `Cron complete: ${detail}`);
    return { usersChecked: usersToCheck.length, emailsSent: fulfilled, details };
  } catch (err) {
    logger.error({ context: "email", err }, "Cron error during email job enqueue");
    throw err;
  }
}

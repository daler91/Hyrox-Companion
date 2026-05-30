import type { User } from "@shared/schema";

import { type MissedWorkoutData,sendMissedWorkoutReminder, sendWeeklySummary, type WeeklySummaryData } from "./email";
import { logger } from "./logger";
import { sendPushToUser } from "./pushNotifications";
import { sendJobNoRetry } from "./queue";
import { calculateStreak } from "./routeUtils";
import type { IStorage } from "./storage";
import { addDaysLocal, getLocalDateStr, getLocalDayOfWeek } from "./timezone";

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

  const lastSent = user.lastWeeklySummaryAt;
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (lastSent && lastSent >= sevenDaysAgo) return false;

  // "Last week" = the seven calendar days ending yesterday in the user's
  // local tz, i.e. last Monday through yesterday (Sunday) inclusive.
  const todayStr = getLocalDateStr(now, tz);
  const weekEndStr = addDaysLocal(todayStr, -1);
  const weekStartStr = addDaysLocal(weekEndStr, -6);

  const [stats, timeline] = await Promise.all([
    storage.analytics.getWeeklyStats(user.id, weekStartStr, weekEndStr),
    storage.timeline.getTimeline(user.id),
  ]);
  const completedDates = new Set(
    timeline
      .filter(e => e.status === "completed" && e.date)
      .map(e => e.date)
  );
  const streak = calculateStreak(completedDates);

  const total = stats.completedCount + stats.missedCount + stats.skippedCount;
  const summaryData: WeeklySummaryData = {
    completedCount: stats.completedCount,
    plannedCount: stats.plannedCount,
    missedCount: stats.missedCount,
    skippedCount: stats.skippedCount,
    completionRate: total > 0 ? Math.round((stats.completedCount / total) * 100) : 0,
    currentStreak: streak,
    prsThisWeek: 0,
    totalDuration: stats.totalDuration,
    weekStartDate: weekStartStr,
    weekEndDate: weekEndStr,
  };

  const success = await sendWeeklySummary(user, summaryData);
  if (success) {
    await storage.users.updateLastWeeklySummaryAt(user.id);
  }

  // Also send push notification (fire-and-forget)
  void sendPushToUser(user.id, {
    title: "Weekly Training Summary",
    body: `You completed ${summaryData.completedCount} workouts this week (${summaryData.completionRate}% completion rate).`,
    url: "/analytics",
  });

  return success;
}

export async function processMissedWorkoutReminder(storage: IStorage, user: User, now: Date): Promise<boolean> {
  // See W4 — re-check preferences at send time.
  const fresh = await storage.users.getUser(user.id);
  if (!fresh?.email || !wantsEmail(fresh, "missedReminder")) return false;
  user = fresh;

  const lastMissedSent = user.lastMissedReminderAt;
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (lastMissedSent && lastMissedSent >= oneDayAgo) return false;

  // "Yesterday" is the calendar date one day before today *in the user's
  // local tz* (C10). A Pacific user checked at 02:00 UTC is still on the
  // previous day locally; using server UTC here would skip their reminder.
  const todayStr = getLocalDateStr(now, user.userTimezone);
  const yesterdayStr = addDaysLocal(todayStr, -1);
  const missed = await storage.analytics.getMissedWorkoutsForDate(user.id, yesterdayStr);
  if (missed.length === 0) return false;

  const missedData: MissedWorkoutData[] = missed.map(m => ({
    date: m.date,
    focus: m.focus,
    mainWorkout: m.mainWorkout,
    planName: m.planName,
  }));
  const success = await sendMissedWorkoutReminder(user, missedData);
  if (success) {
    await storage.users.updateLastMissedReminderAt(user.id);
  }

  // Also send push notification (fire-and-forget)
  const missedNames = missedData.map(m => m.focus).join(", ");
  void sendPushToUser(user.id, {
    title: "Missed Workout Reminder",
    body: `You missed: ${missedNames}. Get back on track today!`,
    url: "/",
  });

  return success;
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

    const usersToCheck = await storage.users.getUsersWithEmailNotifications();
    if (usersToCheck.length === 0) {
      return { usersChecked: 0, emailsSent: 0, details: ["No users with email notifications enabled"] };
    }

    logger.info({ context: "email" }, `Cron: Enqueuing email jobs for ${usersToCheck.length} user(s)`);

    const now = new Date();

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

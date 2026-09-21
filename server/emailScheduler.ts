import { formatSecondsToClock } from "@shared/formatClock";
import { type EmailNotifyKind, resolveNotifyHour } from "@shared/notifyHours";
import { isRestLikePlanDay } from "@shared/planDayKind";
import { pooledPercentage, roundOrNull } from "@shared/ratio";
import type { AnalyticsResult, RacePredictionResponse, User } from "@shared/schema";

import {
  type AnalysisDigestData,
  type AnalysisDigestRacePrediction,
  type MissedWorkoutData,
  sendAnalysisDigest,
  sendMafTestReminder,
  sendMissedWorkoutReminder,
  sendTodaySessionBrief,
  sendWeeklyReviewReminder,
  sendWeeklySummary,
  type TodaySessionData,
  todaySessionDeepLink,
  type WeeklyReviewReminderData,
  type WeeklySummaryData,
} from "./email";
import { logger } from "./logger";
import { type PushPayload,sendPushToUser } from "./pushNotifications";
import { sendJobNoRetry } from "./queue";
import { calculateStreak } from "./routeUtils";
import { calculatePersonalRecords, countPersonalRecordsInRange } from "./services/analyticsService";
import { getLocalMondayWeekBoundaries } from "./services/weeklyProgress";
import { buildWeeklyReview } from "./services/weeklyReviewService";
import type { IStorage } from "./storage";
import { addDaysLocal, getLocalDateStr, getLocalDayOfWeek, getLocalHour } from "./timezone";

// Claim windows for the send ledgers. Both are shorter than their nominal
// cadence on purpose: the stamp now lands when the claim is taken rather than
// after the send, so a full-cadence window would put each tick a few seconds
// inside the previous one's and skip it — the mechanism that turned the weekly
// summary fortnightly. The upstream gates (athlete-local Monday for the
// summary, one enqueue per local day at the notify hour for the reminder) are
// what set the real cadence; these only have to stop a second send on the same
// local day.
const WEEKLY_CLAIM_WINDOW_MS = 6 * 24 * 60 * 60 * 1000;
const MISSED_CLAIM_WINDOW_MS = 20 * 60 * 60 * 1000;
// Same reasoning for the newer emails: the Sunday gate makes the review
// reminder weekly and the notify-hour gate makes the brief daily; the digest's
// 6-day window is also what caps it at about one email a week.
const WEEKLY_REVIEW_CLAIM_WINDOW_MS = 6 * 24 * 60 * 60 * 1000;
const TODAY_SESSION_CLAIM_WINDOW_MS = 20 * 60 * 60 * 1000;
const ANALYSIS_DIGEST_CLAIM_WINDOW_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * A brief hour from midday on means the athlete reads email in the afternoon
 * or evening, when "today's session" is behind them — brief tomorrow instead.
 */
const BRIEF_TOMORROW_FROM_HOUR = 12;

export type EmailJobName =
  | "send-weekly-summary"
  | "send-missed-reminder"
  | "send-weekly-review-reminder"
  | "send-today-session"
  | "send-analysis-digest";

/** Alias kept local so the many `wantsEmail(user, kind)` call sites read unchanged. */
type EmailKind = EmailNotifyKind;

/** The per-type opt-in column behind each email kind (all default off). */
const EMAIL_TOGGLE_COLUMN: Record<EmailKind, keyof User> = {
  weeklySummary: "emailWeeklySummary",
  missedReminder: "emailMissedReminder",
  weeklyReviewReminder: "emailWeeklyReviewReminder",
  todaySession: "emailTodaySession",
  analysisDigest: "emailAnalysisDigest",
};

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

  // Two slim projections instead of the full hydrated timeline + every set
  // row: the streak only needs the distinct completed dates, and the PR pass
  // only reads the columns calculatePersonalRecords compares (audit M-perf).
  const [stats, completedDates, allSets] = await Promise.all([
    storage.analytics.getWeeklyStats(user.id, weekStartStr, weekEndStr),
    storage.timeline.getCompletedWorkoutDates(user.id),
    storage.analytics.getExerciseSetsForPersonalRecords(user.id),
  ]);
  const streak = calculateStreak(completedDates, tz);
  // "PRs This Week" = all-time bests first achieved within last week's window
  // (W18). Computed over the user's full history so only true records count.
  const prsThisWeek = countPersonalRecordsInRange(
    calculatePersonalRecords(allSets, { weightUnit: user.weightUnit, distanceUnit: user.distanceUnit }),
    weekStartStr,
    weekEndStr,
  );

  // Completion rate comes from plan days ALONE: how many of the week's due
  // sessions were completed. It used to divide `workout_logs` completions by
  // (those completions + plan-day misses + plan-day skips) -- a numerator and
  // denominator from two different tables. An athlete with no plan has no
  // misses and no skips, so the sum was just their own workout count and the
  // email told them 100%, captioned "3 of 3 planned sessions" (audit H6).
  //
  // Excused days are already subtracted from `plannedCount`/`missedCount` by
  // the storage layer, so a week spent injured is not a week of failures.
  // `null` when nothing was due: no plan is not the same as a perfect score.
  const dueCount =
    stats.planCompletedCount + stats.plannedCount + stats.missedCount + stats.skippedCount;
  const completionRate = roundOrNull(pooledPercentage(stats.planCompletedCount, dueCount), 0);
  const summaryData: WeeklySummaryData = {
    completedCount: stats.completedCount,
    planCompletedCount: stats.planCompletedCount,
    dueCount,
    plannedCount: stats.plannedCount,
    missedCount: stats.missedCount,
    skippedCount: stats.skippedCount,
    excusedCount: stats.excusedCount,
    completionRate,
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

  // Also send push notification (fire-and-forget). The .catch is load-bearing:
  // sendPushToUser awaits a DB read before its own allSettled guard, and an
  // unguarded rejection here would hit the process-wide unhandledRejection
  // handler, which exits(1) — one transient DB blip during the cron burst
  // would take down the whole API.
  void sendPushToUser(user.id, {
    title: "Weekly Training Summary",
    body:
      summaryData.completionRate == null
        ? `You completed ${summaryData.completedCount} workouts this week.`
        : `You completed ${summaryData.completedCount} workouts this week (${summaryData.completionRate}% completion rate).`,
    // The review of THIS week, not /analytics — which shows a different set of
    // numbers over a different window than the notification just quoted.
    url: `/review?week=${encodeURIComponent(weekStartStr)}`,
  }).catch((err: unknown) => {
    // err is a push/DB delivery error and userId is an opaque Clerk id — no PII content.
    // bearer:disable javascript_lang_logger_leak
    logger.error({ err, userId: user.id }, "weekly summary push send failed");
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

  // Also send push notification (fire-and-forget; .catch is load-bearing —
  // see processWeeklySummary).
  void sendPushToUser(user.id, buildMissedWorkoutPush(missedData)).catch((err: unknown) => {
    // err is a push/DB delivery error and userId is an opaque Clerk id — no PII content.
    // bearer:disable javascript_lang_logger_leak
    logger.error({ err, userId: user.id }, "missed workout push send failed");
  });

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

  // Push is fire-and-forget and no-ops when the user has no subscription
  // (.catch is load-bearing — see processWeeklySummary).
  void sendPushToUser(user.id, {
    title: "Time for your MAF test",
    body: "Run a fixed distance or time at your MAF heart-rate ceiling, then log the run to track your aerobic progress.",
    url: "/log",
  }).catch((err: unknown) => {
    // err is a push/DB delivery error and userId is an opaque Clerk id — no PII content.
    // bearer:disable javascript_lang_logger_leak
    logger.error({ err, userId: user.id }, "MAF test push send failed");
  });

  return emailSent;
}

function wantsEmail(user: User, kind: EmailKind): boolean {
  if (!user.emailNotifications) return false;
  return user[EMAIL_TOGGLE_COLUMN[kind]] === true;
}

/**
 * Which email jobs this hourly tick should enqueue for one athlete.
 *
 * The cron fires every hour in UTC; this is where each email's own moment is
 * resolved against the athlete's wall clock. Every email carries its own send
 * hour, falling back to the athlete's default send time (`notifyHour`, default
 * 07:00) when they have not given that one a time of its own — the review
 * reminder falls back to Sunday evening instead (shared/notifyHours.ts). The
 * weekday gates are unchanged: the summary only on their local Monday, the
 * review reminder only on their local Sunday. Pure, so the gating table is
 * unit-testable without the queue.
 *
 * Throws on an unusable `userTimezone` (Intl rejects the name); the scan
 * catches that per user so one stale zone cannot silence everyone else.
 */
export function planEmailJobsForUser(user: User, now: Date): EmailJobName[] {
  const tz = user.userTimezone;
  const localHour = getLocalHour(now, tz);
  const localDayOfWeek = getLocalDayOfWeek(now, tz);
  const atHourFor = (kind: EmailKind) => localHour === resolveNotifyHour(user, kind);

  const jobs: EmailJobName[] = [];
  if (localDayOfWeek === 1 && wantsEmail(user, "weeklySummary") && atHourFor("weeklySummary")) {
    jobs.push("send-weekly-summary");
  }
  if (wantsEmail(user, "missedReminder") && atHourFor("missedReminder")) {
    jobs.push("send-missed-reminder");
  }
  if (wantsEmail(user, "todaySession") && atHourFor("todaySession")) {
    jobs.push("send-today-session");
  }
  if (wantsEmail(user, "analysisDigest") && atHourFor("analysisDigest")) {
    jobs.push("send-analysis-digest");
  }
  // The review reminder keeps its own day — Sunday, when the week is closing —
  // and defaults to the evening hour the Timeline prompt shares, unless the
  // athlete has picked a time for it.
  if (localDayOfWeek === 0 && wantsEmail(user, "weeklyReviewReminder") && atHourFor("weeklyReviewReminder")) {
    jobs.push("send-weekly-review-reminder");
  }
  return jobs;
}

/**
 * Sunday-evening nudge to write the weekly review, with the week so far.
 *
 * Skipped without burning the week's claim when the athlete already has a
 * `weekly_reviews` row for this week — that row is written by the review page,
 * so its existence is the closest thing to "already reviewed" the app records.
 */
export async function processWeeklyReviewReminder(storage: IStorage, user: User, now: Date): Promise<boolean> {
  // See W4 — re-check preferences at send time.
  const fresh = await storage.users.getUser(user.id);
  if (!fresh?.email || !wantsEmail(fresh, "weeklyReviewReminder")) return false;
  user = fresh;

  const tz = user.userTimezone;
  if (getLocalDayOfWeek(now, tz) !== 0) return false;

  // Sunday evening: the week closing tonight is the CURRENT local week.
  const { current } = getLocalMondayWeekBoundaries(now, tz);
  const weekStart = current.weekStart;
  const intents = await storage.weeklyReviews.getIntents(user.id, [weekStart]);
  if (intents.has(weekStart)) return false;

  const claimed = await storage.users.claimWeeklyReviewReminder(
    user.id,
    new Date(now.getTime() - WEEKLY_REVIEW_CLAIM_WINDOW_MS),
    now,
  );
  if (!claimed) return false;

  // Any date inside the week anchors it; today (local) is inside this week.
  const review = await buildWeeklyReview(storage, user.id, { now, week: getLocalDateStr(now, tz) });
  const data: WeeklyReviewReminderData = {
    weekStart: review.weekStart,
    weekEnd: review.weekEnd,
    weeklyGoal: review.weeklyGoal,
    sessionsLogged: review.current.sessionsLogged,
    sessionsPlanned: review.current.sessionsPlanned,
    plannedCompleted: review.current.plannedCompleted,
    missed: review.current.missed,
    totalDurationMin: review.current.totalDurationMin,
    avgRpe: review.current.avgRpe,
    personalRecords: review.personalRecords.map((pr) => ({ exerciseName: pr.exerciseName, metric: pr.metric })),
    previousIntent: review.previousIntent,
  };
  const sent = await sendWeeklyReviewReminder(user, data);

  // Push rides along fire-and-forget (.catch is load-bearing — see processWeeklySummary).
  void sendPushToUser(user.id, {
    title: "Your week is wrapping up",
    body: `${data.sessionsLogged} session${data.sessionsLogged === 1 ? "" : "s"} so far — take two minutes to review it.`,
    url: `/review?week=${encodeURIComponent(review.weekStart)}`,
  }).catch((err: unknown) => {
    // err is a push/DB delivery error and userId is an opaque Clerk id — no PII content.
    // bearer:disable javascript_lang_logger_leak
    logger.error({ err, userId: user.id }, "weekly review reminder push send failed");
  });

  return sent;
}

/**
 * Which local date the brief covers, decided by the brief's OWN send hour
 * rather than the athlete's default one: a brief that lands in the afternoon
 * or evening is read when today's session is already behind them, so it
 * covers tomorrow instead.
 */
export function planBriefDate(user: User, now: Date): { targetDate: string; isTomorrow: boolean } {
  const today = getLocalDateStr(now, user.userTimezone);
  const isTomorrow = resolveNotifyHour(user, "todaySession") >= BRIEF_TOMORROW_FROM_HOUR;
  return { targetDate: isTomorrow ? addDaysLocal(today, 1) : today, isTomorrow };
}

/**
 * The day's planned session (tomorrow's, when the brief's own send hour is
 * afternoon/evening). Rest-like days, excused days and empty days send nothing
 * and burn no claim, so the ledger only ever records a brief that went out.
 */
export async function processTodaySessionBrief(storage: IStorage, user: User, now: Date): Promise<boolean> {
  // See W4 — re-check preferences at send time.
  const fresh = await storage.users.getUser(user.id);
  if (!fresh?.email || !wantsEmail(fresh, "todaySession")) return false;
  user = fresh;

  const { targetDate, isTomorrow } = planBriefDate(user, now);

  const sessions = (await storage.analytics.getPlannedSessionsForDate(user.id, targetDate)).filter(
    (session) => !isRestLikePlanDay(session.focus, session.mainWorkout),
  );
  if (sessions.length === 0) return false;

  const claimed = await storage.users.claimTodaySession(
    user.id,
    new Date(now.getTime() - TODAY_SESSION_CLAIM_WINDOW_MS),
    now,
  );
  if (!claimed) return false;

  const data: TodaySessionData = { date: targetDate, isTomorrow, sessions };
  const sent = await sendTodaySessionBrief(user, data);

  void sendPushToUser(user.id, buildTodaySessionPush(data)).catch((err: unknown) => {
    // err is a push/DB delivery error and userId is an opaque Clerk id — no PII content.
    // bearer:disable javascript_lang_logger_leak
    logger.error({ err, userId: user.id }, "session brief push send failed");
  });

  return sent;
}

/** The session-brief push: names the session and deep-links to it, like the missed-workout push. */
export function buildTodaySessionPush(data: TodaySessionData): PushPayload {
  const dayWord = data.isTomorrow ? "Tomorrow" : "Today";
  const [first] = data.sessions;
  if (data.sessions.length === 1 && first) {
    const parts: string[] = [];
    if (first.expectedDurationMin != null) parts.push(`~${first.expectedDurationMin} min`);
    if (first.expectedRpe != null) parts.push(`RPE ${first.expectedRpe}`);
    return {
      title: `${dayWord}: ${first.focus}`,
      body: parts.length > 0 ? parts.join(" · ") : first.mainWorkout.substring(0, 120),
      url: todaySessionDeepLink(data.sessions),
    };
  }
  return {
    title: `${dayWord}: ${data.sessions.length} sessions`,
    body: data.sessions.map((s) => s.focus).join(", "),
    url: "/",
  };
}

/** The coach's stored Markdown, or null when the row is missing or malformed. */
function readCoachInsights(row: AnalyticsResult | undefined): string | null {
  const payload = row?.payload as { insights?: unknown } | null | undefined;
  return typeof payload?.insights === "string" && payload.insights.trim().length > 0 ? payload.insights : null;
}

/** The stored race prediction's headline fields, or null when the row is missing or malformed. */
function readRacePrediction(row: AnalyticsResult | undefined): AnalysisDigestRacePrediction | null {
  const payload = row?.payload as Partial<RacePredictionResponse> | null | undefined;
  if (!row || typeof payload?.totalFinishSeconds !== "number" || !Number.isFinite(payload.totalFinishSeconds)) {
    return null;
  }
  const percentile = payload.percentile;
  const readiness = payload.raceReadiness;
  return {
    totalFinishSeconds: payload.totalFinishSeconds,
    overallConfidence: typeof payload.overallConfidence === "string" ? payload.overallConfidence : "low",
    percentile:
      percentile && typeof percentile.fasterThanPct === "number" && typeof percentile.cohortLabel === "string"
        ? {
            fasterThanPct: percentile.fasterThanPct,
            cohortLabel: percentile.cohortLabel,
            cohortSize: typeof percentile.cohortSize === "number" ? percentile.cohortSize : 0,
          }
        : null,
    raceReadiness:
      readiness && typeof readiness.status === "string" && typeof readiness.guidance === "string"
        ? { status: readiness.status, guidance: readiness.guidance }
        : null,
    generatedAt: row.generatedAt.toISOString(),
  };
}

/**
 * The stored race prediction and coach insights, by email, when either is
 * newer than the last digest. Reads `analytics_results` only — nothing here
 * triggers a recompute or spends AI budget — so an athlete who has never opened
 * those surfaces has no rows and gets no email.
 */
export async function processAnalysisDigest(storage: IStorage, user: User, now: Date): Promise<boolean> {
  // See W4 — re-check preferences at send time.
  const fresh = await storage.users.getUser(user.id);
  if (!fresh?.email || !wantsEmail(fresh, "analysisDigest")) return false;
  user = fresh;

  const rows = await storage.analyticsResults.getMany([user.id]);
  const coachRow = rows.find((row) => row.feature === "coach_insights");
  const raceRow = rows.find((row) => row.feature === "race_prediction");
  const coachInsightsMarkdown = readCoachInsights(coachRow);
  const racePrediction = readRacePrediction(raceRow);
  if (!coachInsightsMarkdown && !racePrediction) return false;

  // Only what actually rendered counts as "new": a malformed row is ignored
  // rather than allowed to trigger a digest that would then not mention it.
  const generatedAts = [
    coachInsightsMarkdown ? coachRow?.generatedAt.getTime() : undefined,
    racePrediction ? raceRow?.generatedAt.getTime() : undefined,
  ].filter((t): t is number => typeof t === "number");
  const newest = Math.max(...generatedAts);
  if (user.lastAnalysisDigestAt && newest <= user.lastAnalysisDigestAt.getTime()) return false;

  const claimed = await storage.users.claimAnalysisDigest(
    user.id,
    new Date(now.getTime() - ANALYSIS_DIGEST_CLAIM_WINDOW_MS),
    now,
  );
  if (!claimed) return false;

  const data: AnalysisDigestData = {
    racePrediction,
    coachInsightsMarkdown,
    coachInsightsGeneratedAt: coachInsightsMarkdown ? (coachRow?.generatedAt.toISOString() ?? null) : null,
  };
  const sent = await sendAnalysisDigest(user, data);

  const insightsSuffix = coachInsightsMarkdown ? " · new coach insights" : "";
  const pushBody = racePrediction
    ? `Predicted finish ${formatSecondsToClock(racePrediction.totalFinishSeconds)}${insightsSuffix}`
    : "New coach insights are waiting for you.";

  void sendPushToUser(user.id, {
    title: "Your training analysis is ready",
    body: pushBody,
    url: "/analytics",
  }).catch((err: unknown) => {
    // err is a push/DB delivery error and userId is an opaque Clerk id — no PII content.
    // bearer:disable javascript_lang_logger_leak
    logger.error({ err, userId: user.id }, "analysis digest push send failed");
  });

  return sent;
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
    const now = new Date();
    // ⚡ Bolt Optimization: these three used to await sequentially, but they
    // touch disjoint data (a plan_days write vs. two differently-filtered
    // full scans of the users table) with no ordering dependency between
    // them — the enqueue loop below only runs once all three have settled.
    // Running them concurrently turns 3 sequential round trips into 1 on
    // this once-daily cron, which currently scans every user in the app
    // twice, back to back.
    const [markedMissed, usersToCheck, dueMafUsers] = await Promise.all([
      storage.plans.markMissedPlanDays(),
      storage.users.getUsersWithEmailNotifications(),
      storage.users.getUsersWithDueMafBaselineTest(now),
    ]);
    if (markedMissed > 0) {
      logger.info({ context: "email" }, `Marked ${markedMissed} past planned day(s) as missed`);
    }
    if (usersToCheck.length === 0 && dueMafUsers.length === 0) {
      return { usersChecked: 0, emailsSent: 0, details: ["No users with email notifications or due MAF tests"] };
    }

    // logs only enqueue counts
    // (integers) and a static context tag; no PII or secrets.
    // bearer:disable javascript_lang_logger_leak
    logger.info({ context: "email" }, `Cron: Planning jobs for ${usersToCheck.length} email user(s) + ${dueMafUsers.length} due MAF test(s)`);

    // Await every enqueue so reported counts reflect what actually made it into
    // the queue (CODEBASE_AUDIT.md §5b). Fire-and-forget would overreport when
    // pg-boss backpressure or DB errors reject some sends.
    type EnqueueMeta = { userId: string; jobName: string };
    const ops: Promise<unknown>[] = [];
    const meta: EnqueueMeta[] = [];
    // Respect per-type email toggles AND per-user timezone when enqueueing.
    // The cron ticks hourly in UTC and planEmailJobsForUser resolves each
    // athlete's notify hour and weekday against THEIR timezone, so a Hawaii
    // user's Monday 07:00 (UTC Monday 17:00) and a Sydney user's Monday 07:00
    // (UTC Sunday 21:00) each get their weekly-summary job on exactly one
    // tick (C10).
    for (const user of usersToCheck) {
      let jobs: EmailJobName[];
      try {
        jobs = planEmailJobsForUser(user, now);
      } catch (err) {
        // An unrecognised stored timezone. Skip this athlete rather than let
        // one bad row abort the scan for everyone. userId is an opaque id.
        // bearer:disable javascript_lang_logger_leak
        logger.error({ context: "email", userId: user.id, err }, "Could not plan email jobs for user");
        continue;
      }
      for (const jobName of jobs) {
        ops.push(sendJobNoRetry(jobName, { userId: user.id }));
        meta.push({ userId: user.id, jobName });
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

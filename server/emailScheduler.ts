import type { User } from "@shared/schema";

import { type MissedWorkoutData,sendMissedWorkoutReminder, sendWeeklySummary, type WeeklySummaryData } from "./email";
import { logger } from "./logger";
import { sendPushToUser } from "./pushNotifications";
import { sendJob } from "./queue";
import { calculateStreak } from "./routeUtils";
import type { IStorage } from "./storage";
import { toDateStr } from "./types";

export async function processWeeklySummary(storage: IStorage, user: User, now: Date): Promise<boolean> {
  const dayOfWeek = now.getDay();
  if (dayOfWeek !== 1) return false;

  const lastSent = user.lastWeeklySummaryAt;
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (lastSent && lastSent >= sevenDaysAgo) return false;

  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() - 1);
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartStr = toDateStr(weekStart);
  const weekEndStr = toDateStr(weekEnd);

  const stats = await storage.analytics.getWeeklyStats(user.id, weekStartStr, weekEndStr);
  const timeline = await storage.timeline.getTimeline(user.id);
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
  const lastMissedSent = user.lastMissedReminderAt;
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (lastMissedSent && lastMissedSent >= oneDayAgo) return false;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = toDateStr(yesterday);
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

/**
 * Per-type toggles default to `true` when null/undefined so existing users
 * who predate the migration keep receiving both categories without an
 * explicit opt-in. The master `emailNotifications` still gates everything.
 */
function wantsEmail(user: User, kind: "weeklySummary" | "missedReminder"): boolean {
  if (!user.emailNotifications) return false;
  if (kind === "weeklySummary") return user.emailWeeklySummary ?? true;
  return user.emailMissedReminder ?? true;
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
    const isMonday = now.getDay() === 1;

    // Await every enqueue so reported counts reflect what actually made it into
    // the queue (CODEBASE_AUDIT.md §5b). Fire-and-forget would overreport when
    // pg-boss backpressure or DB errors reject some sends.
    type EnqueueMeta = { userId: string; jobName: string };
    const ops: Promise<unknown>[] = [];
    const meta: EnqueueMeta[] = [];
    // Respect per-type email toggles when enqueueing. Users who have
    // opted out of weekly summaries shouldn't get a job enqueued for
    // them at all — avoids wasted queue capacity and downstream
    // processing for an email that would immediately short-circuit.
    for (const user of usersToCheck) {
      if (isMonday && wantsEmail(user, "weeklySummary")) {
        ops.push(sendJob("send-weekly-summary", { userId: user.id }));
        meta.push({ userId: user.id, jobName: "send-weekly-summary" });
      }
      if (wantsEmail(user, "missedReminder")) {
        ops.push(sendJob("send-missed-reminder", { userId: user.id }));
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

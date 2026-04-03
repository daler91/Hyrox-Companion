import type { IStorage } from "./storage";
import type { User } from "@shared/schema";
import { sendWeeklySummary, sendMissedWorkoutReminder, type WeeklySummaryData, type MissedWorkoutData } from "./email";
import { logger } from "./logger";
import { toDateStr } from "./types";
import { calculateStreak } from "./routeUtils";

async function processWeeklySummary(storage: IStorage, user: User, now: Date): Promise<boolean> {
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

  const stats = await storage.getWeeklyStats(user.id, weekStartStr, weekEndStr);
  const timeline = await storage.getTimeline(user.id);
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
    await storage.updateLastWeeklySummaryAt(user.id);
    return true;
  }
  return false;
}

async function processMissedWorkoutReminder(storage: IStorage, user: User, now: Date): Promise<boolean> {
  const lastMissedSent = user.lastMissedReminderAt;
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (lastMissedSent && lastMissedSent >= oneDayAgo) return false;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = toDateStr(yesterday);
  const missed = await storage.getMissedWorkoutsForDate(user.id, yesterdayStr);
  if (missed.length === 0) return false;

  const missedData: MissedWorkoutData[] = missed.map(m => ({
    date: m.date,
    focus: m.focus,
    mainWorkout: m.mainWorkout,
    planName: m.planName,
  }));
  const success = await sendMissedWorkoutReminder(user, missedData);
  if (success) {
    await storage.updateLastMissedReminderAt(user.id);
    return true;
  }
  return false;
}

export async function checkAndSendEmailsForUser(storage: IStorage, user: User): Promise<string[]> {
  const sent: string[] = [];
  if (!user.email || !user.emailNotifications) return sent;

  const now = new Date();

  if (await processWeeklySummary(storage, user, now)) {
    sent.push("weekly_summary");
  }

  if (await processMissedWorkoutReminder(storage, user, now)) {
    sent.push("missed_reminder");
  }

  return sent;
}

interface BatchResult {
  emailsSent: number;
  details: string[];
}

async function processUserBatch(
  storage: IStorage,
  batch: User[],
): Promise<BatchResult> {
  let emailsSent = 0;
  const details: string[] = [];

  const results = await Promise.allSettled(
    batch.map(async (user) => {
      try {
        const sent = await checkAndSendEmailsForUser(storage, user);
        return { user, sent, errorMsg: null as string | null };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { user, sent: [] as string[], errorMsg };
      }
    }),
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { user, sent, errorMsg } = result.value;
    if (errorMsg) {
      const detail = `Failed for user ${user.id}: ${errorMsg}`;
      details.push(detail);
      logger.error({ context: "email", userId: user.id, errorMsg }, "Failed to check and send emails for user");
      continue;
    }
    emailsSent += sent.length;
    if (sent.length > 0) {
      const detail = `Sent ${sent.join(", ")} to ${user.email}`;
      details.push(detail);
      logger.info({ context: "email" }, detail);
    }
  }

  return { emailsSent, details };
}

export async function runEmailCronJob(storage: IStorage): Promise<{ usersChecked: number; emailsSent: number; details: string[] }> {
  const details: string[] = [];
  let emailsSent = 0;

  try {
    const markedMissed = await storage.markMissedPlanDays();
    if (markedMissed > 0) {
      logger.info({ context: "email" }, `Marked ${markedMissed} past planned day(s) as missed`);
    }

    const usersToCheck = await storage.getUsersWithEmailNotifications();
    if (usersToCheck.length === 0) {
      return { usersChecked: 0, emailsSent: 0, details: ["No users with email notifications enabled"] };
    }

    logger.info({ context: "email" }, `Cron: Checking emails for ${usersToCheck.length} user(s)`);

    const CONCURRENCY = 5;
    for (let i = 0; i < usersToCheck.length; i += CONCURRENCY) {
      const batch = usersToCheck.slice(i, i + CONCURRENCY);
      const batchResult = await processUserBatch(storage, batch);
      emailsSent += batchResult.emailsSent;
      details.push(...batchResult.details);
    }

    logger.info({ context: "email" }, `Cron complete: ${emailsSent} email(s) sent to ${usersToCheck.length} user(s)`);
    return { usersChecked: usersToCheck.length, emailsSent, details };
  } catch (err) {
    logger.error({ context: "email", err }, "Cron error during email checks");
    throw err;
  }
}

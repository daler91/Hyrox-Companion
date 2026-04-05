import type { IStorage } from "./storage";
import type { User } from "@shared/schema";
import { sendWeeklySummary, sendMissedWorkoutReminder, type WeeklySummaryData, type MissedWorkoutData } from "./email";
import { logger } from "./logger";
import { toDateStr } from "./types";
import { calculateStreak } from "./routeUtils";
import { queue } from "./queue";

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

export async function processMissedWorkoutReminder(storage: IStorage, user: User, now: Date): Promise<boolean> {
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

export async function runEmailCronJob(storage: IStorage): Promise<{ usersChecked: number; emailsSent: number; details: string[] }> {
  const details: string[] = [];
  let jobsEnqueued = 0;

  try {
    const markedMissed = await storage.markMissedPlanDays();
    if (markedMissed > 0) {
      logger.info({ context: "email" }, `Marked ${markedMissed} past planned day(s) as missed`);
    }

    const usersToCheck = await storage.getUsersWithEmailNotifications();
    if (usersToCheck.length === 0) {
      return { usersChecked: 0, emailsSent: 0, details: ["No users with email notifications enabled"] };
    }

    logger.info({ context: "email" }, `Cron: Enqueuing email jobs for ${usersToCheck.length} user(s)`);

    const now = new Date();
    const isMonday = now.getDay() === 1;

    for (const user of usersToCheck) {
      if (isMonday) {
        queue.send("send-weekly-summary", { userId: user.id }).catch((err) => {
          logger.error({ context: "email", userId: user.id, err }, "Failed to enqueue send-weekly-summary job");
        });
        jobsEnqueued++;
      }

      queue.send("send-missed-reminder", { userId: user.id }).catch((err) => {
        logger.error({ context: "email", userId: user.id, err }, "Failed to enqueue send-missed-reminder job");
      });
      jobsEnqueued++;
    }

    const detail = `Enqueued ${jobsEnqueued} job(s) for ${usersToCheck.length} user(s)`;
    details.push(detail);
    logger.info({ context: "email" }, `Cron complete: ${detail}`);
    return { usersChecked: usersToCheck.length, emailsSent: jobsEnqueued, details };
  } catch (err) {
    logger.error({ context: "email", err }, "Cron error during email job enqueue");
    throw err;
  }
}

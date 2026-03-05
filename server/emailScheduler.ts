import type { IStorage } from "./storage";
import type { User } from "@shared/schema";
import { sendWeeklySummary, sendMissedWorkoutReminder, type WeeklySummaryData, type MissedWorkoutData } from "./email";
import { log } from "./index";

const SCHEDULER_INTERVAL_MS = 30 * 60 * 1000;

export async function checkAndSendEmailsForUser(storage: IStorage, user: User): Promise<string[]> {
  const sent: string[] = [];
  if (!user.email || !user.emailNotifications) return sent;

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const dayOfWeek = now.getDay();

  if (dayOfWeek === 1) {
    const lastSent = user.lastWeeklySummaryAt;
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (!lastSent || lastSent < sevenDaysAgo) {
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() - 1);
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekStart.getDate() - 6);
      const weekStartStr = weekStart.toISOString().split('T')[0];
      const weekEndStr = weekEnd.toISOString().split('T')[0];

      const stats = await storage.getWeeklyStats(user.id, weekStartStr, weekEndStr);
      const timeline = await storage.getTimeline(user.id);
      const completedDates = timeline
        .filter(e => e.status === 'completed' && e.date)
        .map(e => e.date)
        .sort();
      let streak = 0;
      if (completedDates.length > 0) {
        const d = new Date(today);
        d.setDate(d.getDate() - 1);
        while (completedDates.includes(d.toISOString().split('T')[0])) {
          streak++;
          d.setDate(d.getDate() - 1);
        }
      }

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
        sent.push('weekly_summary');
      }
    }
  }

  const lastMissedSent = user.lastMissedReminderAt;
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (!lastMissedSent || lastMissedSent < oneDayAgo) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const missed = await storage.getMissedWorkoutsForDate(user.id, yesterdayStr);
    if (missed.length > 0) {
      const missedData: MissedWorkoutData[] = missed.map(m => ({
        date: m.date,
        focus: m.focus,
        mainWorkout: m.mainWorkout,
        planName: m.planName,
      }));
      const success = await sendMissedWorkoutReminder(user, missedData);
      if (success) {
        await storage.updateLastMissedReminderAt(user.id);
        sent.push('missed_reminder');
      }
    }
  }

  return sent;
}

export function startEmailScheduler(storage: IStorage): void {
  log("Email scheduler started (runs every 30 minutes)", "email");

  const runCheck = async () => {
    try {
      const usersToCheck = await storage.getUsersWithEmailNotifications();
      if (usersToCheck.length === 0) return;

      log(`Checking emails for ${usersToCheck.length} user(s)`, "email");
      let totalSent = 0;

      for (const user of usersToCheck) {
        try {
          const sent = await checkAndSendEmailsForUser(storage, user);
          totalSent += sent.length;
          if (sent.length > 0) {
            log(`Sent ${sent.join(', ')} to ${user.email}`, "email");
          }
        } catch (err) {
          log(`Email check failed for user ${user.id}: ${err}`, "email");
        }
      }

      if (totalSent > 0) {
        log(`Email scheduler completed: ${totalSent} email(s) sent`, "email");
      }
    } catch (err) {
      log(`Email scheduler error: ${err}`, "email");
    }
  };

  runCheck();
  setInterval(runCheck, SCHEDULER_INTERVAL_MS);
}

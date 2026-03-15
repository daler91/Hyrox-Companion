import type { IStorage } from "./storage";
import type { User } from "@shared/schema";
import { sendWeeklySummary, sendMissedWorkoutReminder, type WeeklySummaryData, type MissedWorkoutData } from "./email";
import { log } from "./index";
import { toDateStr } from "./types";
import { calculateStreak } from "./routeUtils";

export async function checkAndSendEmailsForUser(storage: IStorage, user: User): Promise<string[]> {
  const sent: string[] = [];
  if (!user.email || !user.emailNotifications) return sent;

  const now = new Date();
  const dayOfWeek = now.getDay();

  if (dayOfWeek === 1) {
    const lastSent = user.lastWeeklySummaryAt;
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (!lastSent || lastSent < sevenDaysAgo) {
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
          .map(e => e.date!)
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
        sent.push("weekly_summary");
      }
    }
  }

  const lastMissedSent = user.lastMissedReminderAt;
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (!lastMissedSent || lastMissedSent < oneDayAgo) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = toDateStr(yesterday);
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
        sent.push("missed_reminder");
      }
    }
  }

  return sent;
}

export async function runEmailCronJob(storage: IStorage): Promise<{ usersChecked: number; emailsSent: number; details: string[] }> {
  const details: string[] = [];
  let emailsSent = 0;

  try {
    const markedMissed = await storage.markMissedPlanDays();
    if (markedMissed > 0) {
      log(`Marked ${markedMissed} past planned day(s) as missed`, "email");
    }

    const usersToCheck = await storage.getUsersWithEmailNotifications();
    if (usersToCheck.length === 0) {
      return { usersChecked: 0, emailsSent: 0, details: ["No users with email notifications enabled"] };
    }

    log(`Cron: Checking emails for ${usersToCheck.length} user(s)`, "email");

    for (const user of usersToCheck) {
      try {
        const sent = await checkAndSendEmailsForUser(storage, user);
        emailsSent += sent.length;
        if (sent.length > 0) {
          const detail = `Sent ${sent.join(", ")} to ${user.email}`;
          details.push(detail);
          log(detail, "email");
        }
      } catch (err) {
        const detail = `Failed for user ${user.id}: ${err}`;
        details.push(detail);
        log(detail, "email");
      }
    }

    log(`Cron complete: ${emailsSent} email(s) sent to ${usersToCheck.length} user(s)`, "email");
    return { usersChecked: usersToCheck.length, emailsSent, details };
  } catch (err) {
    log(`Cron error: ${err}`, "email");
    throw err;
  }
}

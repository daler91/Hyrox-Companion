import type { TimelineEntry } from "@shared/schema";
import { 
  getTodayString, 
  getStartOfWeekString, 
  getEndOfWeekString, 
  isDateInRange 
} from "./dateUtils";

export interface TrainingStats {
  workoutsThisWeek: number;
  completedThisWeek: number;
  plannedUpcoming: number;
  completionRate: number;
  currentStreak: number;
}

export function calculateStats(timeline: TimelineEntry[]): TrainingStats {
  const todayStr = getTodayString();
  const startOfWeekStr = getStartOfWeekString();
  const endOfWeekStr = getEndOfWeekString();

  // ⚡ Bolt Performance Optimization:
  // Instead of multiple O(N) array filters to compute stats, we iterate
  // over the timeline exactly once. This reduces overhead, especially
  // for users with long workout histories.
  let completedThisWeek = 0;
  let totalThisWeek = 0;
  let plannedUpcoming = 0;
  let totalPastAndToday = 0;
  let completedPastAndTodayCount = 0;
  
  const completedDatesSet = new Set<string>();

  for (let i = 0; i < timeline.length; i++) {
    const entry = timeline[i];

    // Check if in current week
    if (isDateInRange(entry.date, startOfWeekStr, endOfWeekStr)) {
      totalThisWeek++;
      if (entry.status === "completed") {
        completedThisWeek++;
      }
    }

    // Planned upcoming
    if (entry.date >= todayStr && entry.status === "planned") {
      plannedUpcoming++;
    }

    // Past and today entries
    if (entry.date <= todayStr) {
      totalPastAndToday++;
      if (entry.status === "completed") {
        completedDatesSet.add(entry.date);
        completedPastAndTodayCount++;
      }
    }
  }

  const streak = calculateStreak(completedDatesSet);

  return {
    workoutsThisWeek: totalThisWeek,
    completedThisWeek,
    plannedUpcoming,
    completionRate: totalPastAndToday > 0 ? Math.round((completedPastAndTodayCount / totalPastAndToday) * 100) : 0,
    currentStreak: streak,
  };
}

export function calculateStreak(completedDates: Set<string>): number {
  if (completedDates.size === 0) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  if (!completedDates.has(todayStr) && !completedDates.has(yesterdayStr)) return 0;

  let streak = 0;
  let checkDate = completedDates.has(todayStr) ? new Date(today) : new Date(yesterday);

  while (true) {
    const dateStr = checkDate.toISOString().split("T")[0];
    if (completedDates.has(dateStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

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

  const uniqueDays = Array.from(completedDatesSet).sort().reverse();
  
  let streak = 0;
  const checkDate = new Date();
  checkDate.setHours(0, 0, 0, 0);
  
  for (let i = 0; i <= uniqueDays.length; i++) {
    const expectedDateStr = checkDate.toISOString().split("T")[0];
    if (uniqueDays.includes(expectedDateStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else if (i === 0) {
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  return {
    workoutsThisWeek: totalThisWeek,
    completedThisWeek,
    plannedUpcoming,
    completionRate: totalPastAndToday > 0 ? Math.round((completedPastAndTodayCount / totalPastAndToday) * 100) : 0,
    currentStreak: streak,
  };
}

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

  const thisWeekEntries = timeline.filter(entry => 
    isDateInRange(entry.date, startOfWeekStr, endOfWeekStr)
  );

  const completedThisWeek = thisWeekEntries.filter(e => e.status === "completed").length;
  const totalThisWeek = thisWeekEntries.length;
  
  const plannedUpcoming = timeline.filter(e => 
    e.date >= todayStr && e.status === "planned"
  ).length;

  // For completion rate: only count entries from today or earlier
  const pastAndTodayEntries = timeline.filter(e => e.date <= todayStr);
  const completedPastAndToday = pastAndTodayEntries.filter(e => e.status === "completed");
  const totalPastAndToday = pastAndTodayEntries.length;

  // For streak calculation: only use completed entries
  const completedDatesSet = new Set(
    completedPastAndToday.map(e => e.date)
  );
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
    completionRate: totalPastAndToday > 0 ? Math.round((completedPastAndToday.length / totalPastAndToday) * 100) : 0,
    currentStreak: streak,
  };
}

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

  const completedAll = timeline.filter(e => e.status === "completed");
  const completedThisWeek = thisWeekEntries.filter(e => e.status === "completed").length;
  const totalThisWeek = thisWeekEntries.length;
  
  const plannedUpcoming = timeline.filter(e => 
    e.date >= todayStr && e.status === "planned"
  ).length;

  const completedDatesSet = new Set(
    completedAll.map(e => e.date)
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

  const allCompleted = completedAll.length;
  const allPastDue = timeline.filter(e => e.date < todayStr && e.status !== "planned").length;

  return {
    workoutsThisWeek: totalThisWeek,
    completedThisWeek,
    plannedUpcoming,
    completionRate: allPastDue > 0 ? Math.round((allCompleted / allPastDue) * 100) : 0,
    currentStreak: streak,
  };
}

import type { TimelineEntry } from "@shared/schema";

import {
  getEndOfWeekString,
  getStartOfWeekString,
  getTodayString,
  isDateInRange,
  toISODateString,
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
  // Monday-start week to match the server (analyticsService / weeklyProgress
  // use Monday) and plan import, so the Coach Panel's weekly counts agree with
  // Analytics and the Timeline instead of splitting on Sunday.
  const startOfWeekStr = getStartOfWeekString(new Date(), 1);
  const endOfWeekStr = getEndOfWeekString(new Date(), 1);

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

  for (const entry of timeline) {

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

  // Compare against local-TZ date strings to match how `completedDates`
  // is populated (entry.date is stored in the user's local TZ).
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = toISODateString(today);

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = toISODateString(yesterday);

  if (!completedDates.has(todayStr) && !completedDates.has(yesterdayStr)) return 0;

  let streak = 0;
  const checkDate = completedDates.has(todayStr) ? new Date(today) : new Date(yesterday);

  while (true) {
    const dateStr = toISODateString(checkDate);
    if (completedDates.has(dateStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

/** Format a duration in seconds as "H:MM:SS" (e.g. 5732 → "1:35:32"). */
export function formatSecondsToClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${hours}:${mm}:${ss}`;
}

/** Format a split in seconds as "M:SS" (e.g. 272 → "4:32"). */
export function formatSecondsToMmSs(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

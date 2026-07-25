import type { TimelineEntry } from "@shared/schema";

import {
  getEndOfWeekString,
  getStartOfWeekString,
  getTodayString,
  isDateInRange,
} from "./dateUtils";

export interface TrainingStats {
  workoutsThisWeek: number;
  completedThisWeek: number;
  plannedUpcoming: number;
  completionRate: number;
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
        completedPastAndTodayCount++;
      }
    }
  }

  return {
    workoutsThisWeek: totalThisWeek,
    completedThisWeek,
    plannedUpcoming,
    completionRate: totalPastAndToday > 0 ? Math.round((completedPastAndTodayCount / totalPastAndToday) * 100) : 0,
  };
}

export function formatSecondsToClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return "0:00:00";
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
  if (!Number.isFinite(totalSeconds)) return "0:00";
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

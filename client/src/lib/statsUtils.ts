import { pooledPercentage, roundOrNull } from "@shared/ratio";
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
  /**
   * All-time completion rate over days that have finished, as a percentage.
   * `null` when nothing has come due yet — a brand-new athlete has no rate,
   * and rendering that as 0% reads as total failure rather than "no data".
   */
  completionRate: number | null;
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
  let totalElapsed = 0;
  let completedElapsedCount = 0;

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

    // Days that have actually finished. Two exclusions, both of which used to
    // count as failures (audit M5):
    //
    //   - TODAY. The window was `<= todayStr`, so a session the athlete still
    //     has all evening to do was already scored against them. Opening the
    //     app in the morning dropped their rate.
    //   - Days inside a declared absence. `excused` is exactly the flag the
    //     timeline uses to explain why a past date is not red; a week spent
    //     injured is not a week of failures.
    if (entry.date < todayStr && !entry.excused) {
      totalElapsed++;
      if (entry.status === "completed") {
        completedElapsedCount++;
      }
    }
  }

  return {
    workoutsThisWeek: totalThisWeek,
    completedThisWeek,
    plannedUpcoming,
    completionRate: roundOrNull(pooledPercentage(completedElapsedCount, totalElapsed), 0),
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

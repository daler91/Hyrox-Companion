import { pooledPercentage, roundOrNull } from "@shared/ratio";
import type { TimelineEntry } from "@shared/schema";

import {
  getEndOfWeekString,
  getStartOfWeekString,
  getTodayString,
  isDateInRange,
  toISODateString,
} from "./dateUtils";

/**
 * The completion rate scores the finished days of the last 4 weeks only. The
 * Timeline loads in pages of past entries (`DEFAULT_TIMELINE_PAGE_SIZE`, 200,
 * after everything from today on), so an all-loaded-days rate moved each time
 * the athlete tapped "Load older workouts". The first page holds the last 4
 * weeks unless an athlete logs more than 7 sessions a day, so older pages no
 * longer change it. CL59 (CODEBASE_ANALYSIS_2026-10-03)
 */
export const COMPLETION_RATE_WINDOW_DAYS = 28;

/** The first day the completion rate scores: today minus the window, local time. */
function completionRateWindowStart(): string {
  const start = new Date();
  start.setDate(start.getDate() - COMPLETION_RATE_WINDOW_DAYS);
  return toISODateString(start);
}

export interface TrainingStats {
  workoutsThisWeek: number;
  completedThisWeek: number;
  plannedUpcoming: number;
  /**
   * Completion rate over the days among `timeline` that finished in the last
   * `COMPLETION_RATE_WINDOW_DAYS` days, as a percentage. `null` when nothing
   * came due in that window — a brand-new athlete has no rate, and rendering
   * that as 0% reads as total failure rather than "no data".
   */
  completionRate: number | null;
}

/**
 * Counts over the entries passed in, and nothing else. The Coach panel passes
 * the timeline as loaded, under its plan filter, so these are that view's
 * numbers and it labels them so. Each one reads only dates the Timeline's
 * first page holds (this week, today on, the last 4 weeks), so "Load older
 * workouts" does not move them. CL59 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function calculateStats(timeline: TimelineEntry[]): TrainingStats {
  const todayStr = getTodayString();
  const rateWindowStartStr = completionRateWindowStart();
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
    //
    // Nor does a missed session the athlete let go: dropping it was a decision
    // about the plan, and the card already reads "Let go", not "Missed". And
    // only the last 4 weeks, which every loaded view holds (CL59).
    if (
      entry.date >= rateWindowStartStr &&
      entry.date < todayStr &&
      !entry.excused &&
      entry.recovery !== "let_go"
    ) {
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

// Lives in shared/ now so the analysis digest email can quote a finish time
// with the same formatting the Race Predictor tab uses.
export { formatSecondsToClock } from "@shared/formatClock";

/** Format a split in seconds as "M:SS" (e.g. 272 → "4:32"). */
export function formatSecondsToMmSs(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return "0:00";
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

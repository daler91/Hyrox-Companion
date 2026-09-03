/**
 * The home summary card's payload (P4).
 *
 * The card used to read `GET /api/v1/training-overview` with no date range,
 * which assembles the athlete's ENTIRE history (every log, every hydrated set,
 * the full analytics pipeline) to render four week-scoped tiles and a station
 * radar. This computes only what the card shows, from bounded reads:
 *
 * - streak: the two DISTINCT date projections the weekly email already uses;
 * - this week's count: the trailing-window logs filtered to the athlete's
 *   current Monday, the same rule `calculateTrainingOverview` applies;
 * - station radar: coverage over the trailing lookback window, with the same
 *   builders the overview uses so the two surfaces agree inside the window.
 *
 * The window is the one deliberate difference: a station last trained before
 * it reports `lastTrained: null`, and the payload says how long the window is
 * so the radar can word that honestly instead of calling it "never trained".
 */
import { addDaysToISODate } from "@shared/dateUtils";
import type { TrainingSummary } from "@shared/schema";
import { buildStationCoverage } from "@shared/stationCoverage";

import { calculateStreak } from "../routeUtils";
import { storage } from "../storage";
import { getLocalDateStrSafe } from "../timezone";
import { buildCoverageSources } from "./analyticsService";
import { getMondayWeekBoundaries } from "./weeklyProgress";

/** Long enough that every radar tone has saturated well before the edge. */
export const SUMMARY_COVERAGE_LOOKBACK_DAYS = 180;

const DEFAULT_WEEKLY_GOAL = 5;

export async function assembleTrainingSummary(userId: string): Promise<TrainingSummary> {
  const user = await storage.users.getUser(userId);
  const userTimezone = user?.userTimezone ?? undefined;
  const now = new Date();
  const todayStr = getLocalDateStrSafe(now, userTimezone);
  const windowStart = addDaysToISODate(todayStr, -SUMMARY_COVERAGE_LOOKBACK_DAYS);

  const [completedDates, workoutLogs, exerciseSets] = await Promise.all([
    storage.timeline.getCompletedWorkoutDates(userId),
    storage.analytics.getWorkoutLogsByDateRange(userId, windowStart, todayStr),
    storage.analytics.getExerciseSetsForPersonalRecords(userId, windowStart, todayStr),
  ]);

  const { thisMondayStr } = getMondayWeekBoundaries(now, userTimezone);

  return {
    currentStreak: calculateStreak(completedDates, userTimezone),
    weeklyCompletedWorkouts: workoutLogs.filter((log) => log.date >= thisMondayStr).length,
    weeklyGoal: user?.weeklyGoal ?? DEFAULT_WEEKLY_GOAL,
    stationCoverage: buildStationCoverage(buildCoverageSources(workoutLogs, exerciseSets), todayStr),
    coverageLookbackDays: SUMMARY_COVERAGE_LOOKBACK_DAYS,
  };
}

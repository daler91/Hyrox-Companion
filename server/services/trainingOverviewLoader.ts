/**
 * Shared assembly for the Training Overview surface.
 *
 * The `GET /api/v1/training-overview` route AND the Overview AI chart-analysis
 * service both need the SAME computed `TrainingOverview` (so the AI explains the
 * exact numbers the charts render). The assembly — which date windows to fetch
 * and how to feed `calculateTrainingOverview` — lives here once. Data fetching
 * is injected so the route can pass its request-coalescing caches while the AI /
 * cron path uses raw storage.
 */
import type { TrainingOverview, WorkoutLog } from "@shared/schema";

import { storage } from "../storage";
import { calculateTrainingOverview, type ExerciseSetWithDate } from "./analyticsService";

/** Today's date (UTC) as YYYY-MM-DD. */
export function todayUtcYyyyMmDd(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .split("T")[0];
}

/** Add (or subtract) whole calendar days to a YYYY-MM-DD string, in UTC. */
export function addCalendarDays(date: string, delta: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().split("T")[0];
}

/**
 * Returns the pair of ISO dates that bound the period immediately BEFORE
 * [from, to], with the same length. Returns null when we can't derive a
 * meaningful previous window (e.g. the user picked "all time" so there's no
 * lower bound to anchor the comparison).
 */
export function computePreviousWindow(from?: string, to?: string): { from: string; to: string } | null {
  if (!from) return null;
  const fromDate = new Date(`${from}T00:00:00Z`);
  // When `to` is absent (the common ?from=... flow), anchor the current window's
  // upper bound at midnight UTC of today. Using `new Date()` with a wall-clock
  // time component would make (to - from) include fractional days, skewing the
  // previous window by a day for most of the calendar day.
  let toDate: Date;
  if (to) {
    toDate = new Date(`${to}T00:00:00Z`);
  } else {
    const now = new Date();
    toDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return null;
  if (toDate < fromDate) return null;

  const dayMs = 24 * 60 * 60 * 1000;
  const previousTo = new Date(fromDate.getTime() - dayMs);
  const previousFrom = new Date(previousTo.getTime() - (toDate.getTime() - fromDate.getTime()));

  return {
    from: previousFrom.toISOString().split("T")[0],
    to: previousTo.toISOString().split("T")[0],
  };
}

type RangeFetcher<T> = (userId: string, from?: string, to?: string) => Promise<T>;

/** Pluggable data sources so the route can inject its coalescing caches. */
export interface TrainingOverviewFetchers {
  workoutLogs: RangeFetcher<WorkoutLog[]>;
  exerciseSets: RangeFetcher<ExerciseSetWithDate[]>;
}

const defaultFetchers: TrainingOverviewFetchers = {
  workoutLogs: (userId, from, to) => storage.analytics.getWorkoutLogsByDateRange(userId, from, to),
  exerciseSets: (userId, from, to) => storage.analytics.getAllExerciseSetsWithDates(userId, from, to),
};

/**
 * Load + compute the full Training Overview for a user over [from, to]
 * (both optional → "all time"), including the trailing 70-day window the
 * training-load model needs and the equal-length previous window for deltas.
 */
export async function assembleTrainingOverview(
  userId: string,
  from?: string,
  to?: string,
  fetchers: TrainingOverviewFetchers = defaultFetchers,
): Promise<TrainingOverview> {
  const previousWindow = computePreviousWindow(from, to);
  const loadCurrentDate = to ?? todayUtcYyyyMmDd();
  const loadHistoryStart = addCalendarDays(loadCurrentDate, -70);

  const [
    workoutLogs,
    allSets,
    previousWorkoutLogs,
    user,
    loadTags,
    loadWorkoutLogs,
    loadExerciseSets,
  ] = await Promise.all([
    fetchers.workoutLogs(userId, from, to),
    fetchers.exerciseSets(userId, from, to),
    previousWindow
      ? fetchers.workoutLogs(userId, previousWindow.from, previousWindow.to)
      : Promise.resolve(undefined),
    storage.users.getUser(userId),
    storage.analytics.getExerciseLoadTags(),
    fetchers.workoutLogs(userId, loadHistoryStart, loadCurrentDate),
    fetchers.exerciseSets(userId, loadHistoryStart, loadCurrentDate),
  ]);

  return calculateTrainingOverview(workoutLogs, allSets, previousWorkoutLogs, {
    weeklyGoal: user?.weeklyGoal ?? 5,
    loadTags,
    trainingLoadInput: {
      workoutLogs: loadWorkoutLogs,
      exerciseSets: loadExerciseSets,
      currentDate: loadCurrentDate,
    },
    userTimezone: user?.userTimezone,
    weightUnit: user?.weightUnit ?? "kg",
    athlete: {
      age: user?.age ?? null,
      gender: user?.gender ?? null,
      restingHr: user?.restingHr ?? null,
      maxHr: user?.maxHr ?? null,
      ftp: user?.ftp ?? null,
    },
  });
}

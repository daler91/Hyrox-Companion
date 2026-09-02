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
import { addDaysToISODate } from "@shared/dateUtils";
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
export const addCalendarDays = addDaysToISODate;

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

/**
 * The window to count due plan sessions over. Uses the selected range when
 * there is one; otherwise the span of the athlete's own logs, so "all time"
 * still gets a real denominator instead of none.
 */
function resolveAdherenceWindow(
  from: string | undefined,
  to: string | undefined,
  workoutLogs: readonly { date: string }[],
): { from: string; to: string } | null {
  if (from && to) return { from, to };
  if (workoutLogs.length === 0) return null;
  let earliest = workoutLogs[0].date;
  let latest = workoutLogs[0].date;
  for (const log of workoutLogs) {
    if (log.date < earliest) earliest = log.date;
    if (log.date > latest) latest = log.date;
  }
  return { from: from ?? earliest, to: to ?? latest };
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

  // The selected [from, to] window and the trailing-70-day training-load window
  // always share the same upper bound (`to` ?? today), so one is always a
  // superset of the other — one of `from`/`loadHistoryStart` is always the
  // earlier date. Fetching both independently (as this used to) doubles the
  // workout_logs / exercise_sets round-trip on every training-overview load and
  // every AI overview-analysis turn — and the exercise_sets fetch hydrates
  // every logged set via a relational join, so it isn't a cheap query to repeat.
  // Fetch only the wider range once and derive the narrower one by filtering
  // in memory on `date` instead of issuing a second overlapping query.
  const [wideFrom, wideTo] =
    from !== undefined && from > loadHistoryStart
      ? [loadHistoryStart, loadCurrentDate]
      : [from, to];

  const [wideWorkoutLogs, wideSets, previousWorkoutLogs, user, loadTags] = await Promise.all([
    fetchers.workoutLogs(userId, wideFrom, wideTo),
    fetchers.exerciseSets(userId, wideFrom, wideTo),
    previousWindow
      ? fetchers.workoutLogs(userId, previousWindow.from, previousWindow.to)
      : Promise.resolve(undefined),
    storage.users.getUser(userId),
    storage.analytics.getExerciseLoadTags(),
  ]);

  let workoutLogs: WorkoutLog[];
  let allSets: ExerciseSetWithDate[];
  let loadWorkoutLogs: WorkoutLog[];
  let loadExerciseSets: ExerciseSetWithDate[];
  if (from !== undefined && from > loadHistoryStart) {
    // The selected window starts after the load window, so `wide*` above
    // fetched the load window (the wider of the two) — the selected window is
    // its narrower tail.
    workoutLogs = wideWorkoutLogs.filter((log) => log.date >= from);
    allSets = wideSets.filter((set) => set.date >= from);
    loadWorkoutLogs = wideWorkoutLogs;
    loadExerciseSets = wideSets;
  } else {
    // The selected window covers (or equals) the load window — `wide*` fetched
    // the selected window, and the load window is its narrower tail.
    workoutLogs = wideWorkoutLogs;
    allSets = wideSets;
    loadWorkoutLogs = wideWorkoutLogs.filter((log) => log.date >= loadHistoryStart && log.date <= loadCurrentDate);
    loadExerciseSets = wideSets.filter((set) => set.date >= loadHistoryStart && set.date <= loadCurrentDate);
  }

  // "Avg Adherence" divides by the sessions the athlete was DUE, so the count
  // has to come from plan_days rather than from the logs themselves (audit
  // H10). With no selected window ("all time") the athlete's own logged span
  // is used, mirroring how the weekly rollup zero-fills.
  const adherenceWindow = resolveAdherenceWindow(from, to, workoutLogs);
  const [dueSessionCount, previousDueSessionCount] = await Promise.all([
    adherenceWindow
      ? storage.analytics.getDueSessionCount(userId, adherenceWindow.from, adherenceWindow.to, loadCurrentDate)
      : Promise.resolve(undefined),
    previousWindow
      ? storage.analytics.getDueSessionCount(userId, previousWindow.from, previousWindow.to, loadCurrentDate)
      : Promise.resolve(undefined),
  ]);

  return calculateTrainingOverview(workoutLogs, allSets, previousWorkoutLogs, {
    // Pass the selected window through so rest weeks at either end of it are
    // counted rather than dropped (audit H7, M10).
    period: { ...(from ? { from } : {}), ...(to ? { to } : {}) },
    ...(dueSessionCount != null ? { dueSessionCount } : {}),
    ...(previousDueSessionCount != null ? { previousDueSessionCount } : {}),
    weeklyGoal: user?.weeklyGoal ?? 5,
    loadTags,
    trainingLoadInput: {
      workoutLogs: loadWorkoutLogs,
      exerciseSets: loadExerciseSets,
      currentDate: loadCurrentDate,
    },
    userTimezone: user?.userTimezone,
    weightUnit: user?.weightUnit ?? "kg",
    distanceUnit: user?.distanceUnit ?? "km",
    athlete: {
      age: user?.age ?? null,
      gender: user?.gender ?? null,
      restingHr: user?.restingHr ?? null,
      // Scales unweighted-rep tonnage with the body being moved (audit M2).
      bodyweightKg: user?.bodyweightKg ?? null,
      maxHr: user?.maxHr ?? null,
      ftp: user?.ftp ?? null,
    },
  });
}

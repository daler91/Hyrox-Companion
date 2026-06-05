import type { AnalyticsResult } from "@shared/schema";

/**
 * Whether a stored analytics result is stale relative to the athlete's logged
 * history: true when a workout has been logged dated AFTER the latest workout
 * that existed when the result was generated. Compares calendar-date strings
 * (lexicographic ISO compare) to sidestep the date-vs-timestamp mismatch
 * (workout.date is a calendar day, generatedAt is a timestamp).
 *
 * Kept dependency-free (type-only import) so the recompute scheduler can use it
 * without pulling in the storage/AI import chain.
 */
export function computeStale(
  row: Pick<AnalyticsResult, "lastWorkoutDateAtGeneration"> | undefined,
  latestWorkoutDate: string | null,
): boolean {
  if (!row || latestWorkoutDate == null) return false;
  if (row.lastWorkoutDateAtGeneration == null) return true;
  return latestWorkoutDate > row.lastWorkoutDateAtGeneration;
}

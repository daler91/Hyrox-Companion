import type { AnalyticsResult } from "@shared/schema";

/**
 * Whether a stored analytics result is stale relative to the athlete's logged
 * history: true when the anchor has moved AT ALL since the result was
 * generated. Compares calendar-date strings (workout.date is a calendar day,
 * generatedAt is a timestamp, so the anchor sidesteps that mismatch).
 *
 * Deliberately a difference test, not `latest > anchor`. The forward-only form
 * could only ever notice new work, so anything that moved the anchor BACKWARD
 * left permanently wrong analysis with no staleness signal:
 *   - deleting the most recent workout (anchor regresses to an earlier date),
 *   - deleting every workout (anchor regresses to null),
 *   - a back-dated import landing entirely before the anchor — Strava's first
 *     sync backfills up to 90 days of past-dated activities.
 * In each case the stored Race Prediction / Coach Insights were computed over
 * a history that no longer exists, which is exactly what "stale" means.
 *
 * Note the interaction with AI-gated features: the recompute dispatch only
 * persists a new result when consent/budget allow generation, so an athlete
 * with AI disabled keeps reporting stale until they re-enable it. That is
 * honest — the stored analysis really is out of date and really cannot be
 * refreshed — and the scheduler's once-per-day claim bounds the retry to one
 * no-op job per night.
 *
 * Kept dependency-free (type-only import) so the recompute scheduler can use it
 * without pulling in the storage/AI import chain.
 */
export function computeStale(
  row: Pick<AnalyticsResult, "lastWorkoutDateAtGeneration"> | undefined,
  latestWorkoutDate: string | null,
): boolean {
  if (!row) return false;
  return latestWorkoutDate !== row.lastWorkoutDateAtGeneration;
}

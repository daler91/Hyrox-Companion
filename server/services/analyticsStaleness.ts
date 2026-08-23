import type { AnalyticsResult } from "@shared/schema";

/**
 * The state of the athlete's history that a stored analysis was computed over.
 *
 * Two fields, because neither alone is enough:
 *   - `latestDate` catches work that moves the calendar edge (a new workout on
 *     a new day, or deleting the last one).
 *   - `entryCount` catches work that does not: a second session on a day that
 *     already had one, or deleting any row that is not the single latest.
 */
export interface HistoryAnchor {
  /** Latest logged calendar date (YYYY-MM-DD), or null when nothing is logged. */
  latestDate: string | null;
  /** How many rows the anchor table holds for this athlete right now. */
  entryCount: number;
}

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
 * The date is not enough on its own, though, because plenty of change leaves it
 * untouched (audit L16). The count closes those:
 *   - a second session on a day that already had one — a run in the morning and
 *     strength in the evening is an ordinary HYROX week, and the date does not
 *     move for the second one,
 *   - deleting a workout that is not the single latest,
 *   - deleting one of several logged on the latest date.
 *
 * KNOWN GAP, deliberately left: editing a workout IN PLACE — correcting a
 * weight, adding a set, fixing a duration or RPE — moves neither the date nor
 * the count, so it still does not mark the analysis stale. Closing that needs a
 * mutation timestamp the schema does not have: `workout_logs` carries no
 * `updated_at` at all, and set-level edits live in a different table again, so
 * an honest fingerprint is a schema change plus a decision about whether a set
 * edit counts as touching its parent workout. Documented in the audit rather
 * than half-built here.
 *
 * A row written before the count column existed reports `entryCountAtGeneration
 * = null`. That is "no count recorded", NOT "zero rows" — treating it as zero
 * would mark every stored result in the database stale the moment this ships.
 * Such rows fall back to the date-only test they were written under and start
 * carrying a count the next time they are regenerated.
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
  row: Pick<AnalyticsResult, "lastWorkoutDateAtGeneration" | "entryCountAtGeneration"> | undefined,
  anchor: HistoryAnchor,
): boolean {
  if (!row) return false;
  if (anchor.latestDate !== row.lastWorkoutDateAtGeneration) return true;
  if (row.entryCountAtGeneration === null) return false;
  return anchor.entryCount !== row.entryCountAtGeneration;
}

import { QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

import { FOOD_LOG_ALL_DAYS_QUERY_KEYS } from "./nutritionInvalidation";
import type { SyncedRequest } from "./offlineQueue";
import { invalidateWorkoutWriteQueries } from "./workoutInvalidation";

const NUTRITION_URL_PREFIX = "/api/v1/nutrition/";

/**
 * What a replayed food-log write refreshes: every day's reads (the queue
 * doesn't know which days it touched) and the recents strip. The same list the
 * online writes use, so the two can't drift again. CL19 (CODEBASE_ANALYSIS_2026-10-03)
 */
const FOOD_LOG_REPLAY_QUERY_KEYS = [
  ...FOOD_LOG_ALL_DAYS_QUERY_KEYS,
  QUERY_KEYS.nutritionRecent,
] as const;

function ignoreInvalidationFailure(): void {
  // A failed background refetch surfaces on the query that owns it.
}

/**
 * Invalidate the query caches touched by replayed offline mutations, routed
 * by the URLs that actually synced — a replayed nutrition log must refresh
 * nutrition summaries, not just the workout set.
 */
export function invalidateForSyncedRequests(requests: readonly SyncedRequest[] | undefined): void {
  if (!requests || requests.length === 0) {
    // No request metadata (unexpected caller) — fall back to the workout
    // set, the only producer that existed before syncedRequests was added.
    invalidateWorkoutWriteQueries();
    return;
  }

  let workout = false;
  let nutrition = false;
  for (const request of requests) {
    if (request.url.startsWith(NUTRITION_URL_PREFIX)) {
      nutrition = true;
    } else {
      workout = true;
    }
  }

  if (workout) {
    invalidateWorkoutWriteQueries();
  }
  if (nutrition) {
    for (const queryKey of FOOD_LOG_REPLAY_QUERY_KEYS) {
      queryClient.invalidateQueries({ queryKey }).catch(ignoreInvalidationFailure);
    }
  }
}

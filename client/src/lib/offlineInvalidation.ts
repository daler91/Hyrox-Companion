import { QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

import type { SyncedRequest } from "./offlineQueue";
import { invalidateWorkoutWriteQueries } from "./workoutInvalidation";

const NUTRITION_URL_PREFIX = "/api/v1/nutrition/";

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
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.nutritionDayPrefix }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.nutritionRecent }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.nutritionRangePrefix }).catch(() => {});
  }
}

import type { TimelineEntry } from "@shared/schema";

import { QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { mapTimelineCache, type TimelineCache } from "@/lib/timelineCache";

/**
 * Shared plumbing for optimistic timeline mutations: cancel in-flight
 * queries, snapshot the previous state, apply the optimistic update, and
 * return a rollback context. `mutate` sees one page's entries at a time
 * (the cache is paged, see `timelineCache.ts`), which is transparent for the
 * map/filter updates the callers make.
 */
export function buildOptimisticTimelineHandlers<TVariables>(
  selectedPlanId: string | null,
  mutate: (entries: TimelineEntry[], variables: TVariables) => TimelineEntry[],
) {
  const queryKey = [...QUERY_KEYS.timeline, selectedPlanId];
  return {
    onMutate: async (variables: TVariables) => {
      await queryClient.cancelQueries({ queryKey });
      const previousTimeline = queryClient.getQueryData<TimelineCache>(queryKey);
      if (previousTimeline) {
        queryClient.setQueryData<TimelineCache>(queryKey, (old) =>
          mapTimelineCache(old, (entries) => mutate(entries, variables)),
        );
      }
      return { previousTimeline };
    },
    onError: (
      _err: Error,
      _variables: TVariables,
      context: { previousTimeline?: TimelineCache } | undefined,
    ) => {
      if (context?.previousTimeline) {
        queryClient.setQueryData(queryKey, context.previousTimeline);
      }
    },
  };
}

import type { TimelineEntry } from "@shared/schema";

import { QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

/**
 * Shared plumbing for optimistic timeline mutations: cancel in-flight
 * queries, snapshot the previous state, apply the optimistic update, and
 * return a rollback context.
 */
export function buildOptimisticTimelineHandlers<TVariables>(
  selectedPlanId: string | null,
  mutate: (entries: TimelineEntry[], variables: TVariables) => TimelineEntry[],
) {
  const queryKey = [...QUERY_KEYS.timeline, selectedPlanId];
  return {
    onMutate: async (variables: TVariables) => {
      await queryClient.cancelQueries({ queryKey });
      const previousTimeline = queryClient.getQueryData<TimelineEntry[]>(queryKey);
      if (previousTimeline) {
        queryClient.setQueryData<TimelineEntry[]>(queryKey, (old) => {
          if (!old) return old;
          return mutate(old, variables);
        });
      }
      return { previousTimeline };
    },
    onError: (
      _err: Error,
      _variables: TVariables,
      context: { previousTimeline?: TimelineEntry[] } | undefined,
    ) => {
      if (context?.previousTimeline) {
        queryClient.setQueryData(queryKey, context.previousTimeline);
      }
    },
  };
}

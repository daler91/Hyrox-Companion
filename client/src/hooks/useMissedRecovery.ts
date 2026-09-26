import type {
  ApplyMissedRecoveryBody,
  MissedSessionRecoveryPreview,
  PlanDayPriority,
  TimelineEntry,
} from "@shared/schema";
import { useQuery } from "@tanstack/react-query";

import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { mapTimelineCache, type TimelineCache } from "@/lib/timelineCache";

import { useApiMutation } from "./useApiMutation";

/**
 * What folding, shortening or letting a missed session go would each do to
 * the plan. Nothing is fetched until a session is chosen, and the preview is
 * never served from cache: it describes the calendar as it stands, and a
 * session logged or moved in the meantime changes the answer.
 */
export function useMissedRecoveryPreview(planDayId: string | null) {
  return useQuery<MissedSessionRecoveryPreview>({
    queryKey: QUERY_KEYS.missedRecovery(planDayId ?? ""),
    queryFn: () => api.plans.getMissedRecovery(planDayId ?? ""),
    enabled: Boolean(planDayId),
    staleTime: 0,
    gcTime: 0,
  });
}

interface ApplyVariables {
  readonly planDayId: string;
  readonly body: ApplyMissedRecoveryBody;
}

function successTitle(body: ApplyMissedRecoveryBody): string {
  switch (body.action) {
    case "fold":
      return "Session moved";
    case "shorten":
      return "Shorter session planned";
    case "let_go":
      return "Let go — the plan carries on";
    case "reopen":
      return "Back on your list to decide";
  }
}

/** Carry out a recovery decision, then refresh everything that reads the plan. */
export function useApplyMissedRecovery() {
  return useApiMutation<unknown, Error, ApplyVariables>({
    mutationFn: ({ planDayId, body }) => api.plans.applyMissedRecovery(planDayId, body),
    invalidateQueries: [
      QUERY_KEYS.timeline,
      QUERY_KEYS.trainingOverview,
      QUERY_KEYS.plans,
      // Every week's review, whichever one is cached (prefix match).
      ["/api/v1/weekly-review"],
    ],
    successToast: (_data, { body }) => ({ title: successTitle(body) }),
    errorToast: "Couldn't update the session",
    onSuccess: (_data, { planDayId }) => {
      queryClient.removeQueries({ queryKey: QUERY_KEYS.missedRecovery(planDayId) });
    },
  });
}

interface PriorityVariables {
  readonly planDayId: string;
  readonly priority: PlanDayPriority;
}

function withPriority(entries: TimelineEntry[], planDayId: string, priority: PlanDayPriority) {
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.planDayId !== planDayId || entry.priority === priority) return entry;
    changed = true;
    return { ...entry, priority };
  });
  return changed ? next : entries;
}

/**
 * Mark a session key, supporting or optional. The chip flips at once (every
 * cached timeline view is patched, whichever plan filter it is under) and
 * rolls back if the save fails.
 */
export function useSetSessionPriority() {
  return useApiMutation<unknown, Error, PriorityVariables, { previous: [readonly unknown[], TimelineCache | undefined][] }>({
    mutationFn: ({ planDayId, priority }) => api.plans.setDayPriority(planDayId, priority),
    onMutate: async ({ planDayId, priority }) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.timeline });
      const previous = queryClient.getQueriesData<TimelineCache>({ queryKey: QUERY_KEYS.timeline });
      queryClient.setQueriesData<TimelineCache>({ queryKey: QUERY_KEYS.timeline }, (old) =>
        mapTimelineCache(old, (entries) => withPriority(entries, planDayId, priority)),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
    },
    invalidateQueries: [QUERY_KEYS.timeline],
    errorToast: "Couldn't change the session's priority",
  });
}

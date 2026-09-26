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
 * A 404 or 409 from the recovery routes: the session is gone, or is no longer
 * a missed session waiting on a decision — logged, moved or let go, perhaps on
 * another device. The card that offered it was out of date, and asking again
 * will not change the answer.
 */
export function isStaleRecoveryError(error: unknown): boolean {
  return error instanceof Error && (error.message.startsWith("409:") || error.message.startsWith("404:"));
}

function refreshTimeline(): void {
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => undefined);
}

/**
 * What folding, shortening or letting a missed session go would each do to
 * the plan. Nothing is fetched until a session is chosen, and the preview is
 * never served from cache: it describes the calendar as it stands, and a
 * session logged or moved in the meantime changes the answer.
 */
export function useMissedRecoveryPreview(planDayId: string | null) {
  return useQuery<MissedSessionRecoveryPreview>({
    queryKey: QUERY_KEYS.missedRecovery(planDayId ?? ""),
    queryFn: async () => {
      try {
        return await api.plans.getMissedRecovery(planDayId ?? "");
      } catch (error) {
        // Bring the card behind the sheet up to date with what the server knows.
        if (isStaleRecoveryError(error)) refreshTimeline();
        throw error;
      }
    },
    enabled: Boolean(planDayId),
    staleTime: 0,
    gcTime: 0,
    retry: (failureCount, error) => !isStaleRecoveryError(error) && failureCount < 1,
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
    onSuccess: async (_data, { planDayId }) => {
      queryClient.removeQueries({ queryKey: QUERY_KEYS.missedRecovery(planDayId) });
      // Shortening drops or scales the day's prescribed sets; the sheets cache them.
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.planDayExercises(planDayId) });
    },
    onError: async (error, { planDayId }) => {
      if (!isStaleRecoveryError(error)) return;
      // The session changed under the open sheet: show it as it is now.
      refreshTimeline();
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.missedRecovery(planDayId) });
    },
  });
}

interface PriorityVariables {
  readonly planDayId: string;
  readonly priority: PlanDayPriority;
}

/** `entries` with the session's tier set; the same array when nothing changes, so the cache keeps its identity. */
function withPriority(entries: TimelineEntry[], planDayId: string, priority: PlanDayPriority) {
  const needsTier = (entry: TimelineEntry) => entry.planDayId === planDayId && entry.priority !== priority;
  if (!entries.some(needsTier)) return entries;
  return entries.map((entry) => (needsTier(entry) ? { ...entry, priority } : entry));
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

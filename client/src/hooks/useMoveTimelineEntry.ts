import type { TimelineEntry } from "@shared/schema";
import { useCallback } from "react";

import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

import { useApiMutation } from "./useApiMutation";

interface MoveVariables {
  entry: TimelineEntry;
  newDate: string;
}

interface MoveContext {
  previousTimeline?: TimelineEntry[];
}

/**
 * Move a timeline entry to a different day.
 *
 * - Entries backed by a workout log (including completed plan days, which
 *   carry both ids) patch `workout_logs.date`. The timeline renders
 *   completed rows from the log's date, so updating the plan day's
 *   `scheduledDate` instead would leave the card visually pinned to its
 *   old day after the refetch.
 * - Planned entries with no log yet patch `plan_days.scheduledDate`.
 *
 * Both server paths enqueue the auto-coach on a real date change so the
 * coach re-runs on future workouts and reflects the new schedule.
 *
 * Optimistic update: we patch the cached timeline immediately so the card
 * jumps to the new date under the user's cursor; the server response (or
 * the invalidate-driven refetch) resolves the final ordering.
 */
export function useMoveTimelineEntry(selectedPlanId: string | null) {
  const moveMutation = useApiMutation<unknown, Error, MoveVariables, MoveContext>({
    mutationFn: async ({ entry, newDate }: MoveVariables) => {
      if (entry.workoutLogId) {
        await api.workouts.update(entry.workoutLogId, { date: newDate });
        return;
      }
      if (entry.planDayId) {
        await api.plans.updateDayWithoutPlan(entry.planDayId, { scheduledDate: newDate });
        return;
      }
      throw new Error("Cannot move an entry with no plan day or workout log");
    },
    invalidateQueries: [QUERY_KEYS.timeline, QUERY_KEYS.workouts, QUERY_KEYS.plans],
    successToast: "Workout moved",
    errorToast: "Couldn't move workout",
    onMutate: async ({ entry, newDate }) => {
      await queryClient.cancelQueries({ queryKey: [...QUERY_KEYS.timeline, selectedPlanId] });
      const previousTimeline = queryClient.getQueryData<TimelineEntry[]>([
        ...QUERY_KEYS.timeline,
        selectedPlanId,
      ]);
      if (previousTimeline) {
        queryClient.setQueryData<TimelineEntry[]>(
          [...QUERY_KEYS.timeline, selectedPlanId],
          (old) =>
            old?.map((e) => (e.id === entry.id ? { ...e, date: newDate } : e)) ?? old,
        );
      }
      return { previousTimeline };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousTimeline) {
        queryClient.setQueryData(
          [...QUERY_KEYS.timeline, selectedPlanId],
          context.previousTimeline,
        );
      }
    },
  });

  const moveEntry = useCallback(
    (entry: TimelineEntry, newDate: string) => {
      if (entry.date === newDate) return;
      moveMutation.mutate({ entry, newDate });
    },
    [moveMutation],
  );

  return { moveEntry, isMoving: moveMutation.isPending };
}

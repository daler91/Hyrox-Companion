import { weekdayName } from "@shared/dateUtils";
import type { TimelineEntry } from "@shared/schema";
import { format } from "date-fns";
import { useCallback } from "react";

import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { mapTimelineCache, type TimelineCache } from "@/lib/timelineCache";

import { useApiMutation } from "./useApiMutation";

interface MoveVariables {
  entry: TimelineEntry;
  newDate: string;
}

interface MoveContext {
  previousTimeline?: TimelineCache;
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
 *
 * A missed session moved to today or later is folded — planned again, and
 * remembering the day it was missed — exactly as the server records it, so
 * the card does not sit on its new day still reading "Missed" until the
 * refetch lands.
 */
function movedEntry(entry: TimelineEntry, newDate: string): TimelineEntry {
  const today = format(new Date(), "yyyy-MM-dd");
  // The weekday chip goes with the card, as it will in the server's entry.
  const moved = { ...entry, date: newDate, dayName: entry.dayName === undefined ? undefined : weekdayName(newDate) };
  if (entry.status !== "missed" || !entry.planDayId || newDate < today) return moved;
  return { ...moved, status: "planned", recovery: "folded", missedOn: entry.date, recoverable: undefined };
}

function moveEntryDate(entries: TimelineEntry[], entryId: string, newDate: string): TimelineEntry[] {
  return entries.map((e) => (e.id === entryId ? movedEntry(e, newDate) : e));
}

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
      const previousTimeline = queryClient.getQueryData<TimelineCache>([
        ...QUERY_KEYS.timeline,
        selectedPlanId,
      ]);
      if (previousTimeline) {
        queryClient.setQueryData<TimelineCache>(
          [...QUERY_KEYS.timeline, selectedPlanId],
          (old) => mapTimelineCache(old, (entries) => moveEntryDate(entries, entry.id, newDate)),
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

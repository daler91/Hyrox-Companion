import type { TimelineEntry, WorkoutLog } from "@shared/schema";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useState } from "react";

import { useApiMutation } from "@/hooks/useApiMutation";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

interface TimelineTitleMutationOptions {
  readonly setPreviewEntry: Dispatch<SetStateAction<TimelineEntry | null>>;
  readonly setFutureEditEntry: Dispatch<SetStateAction<TimelineEntry | null>>;
  readonly setLogEntry: Dispatch<SetStateAction<TimelineEntry | null>>;
  readonly setReviewEntry: Dispatch<SetStateAction<TimelineEntry | null>>;
  readonly setSkippedEntry: Dispatch<SetStateAction<TimelineEntry | null>>;
}

interface RenameTimelineTitleVariables {
  readonly entry: TimelineEntry;
  readonly title: string;
}

interface RenameTimelineTitleContext {
  readonly targetKey: string | null;
  readonly previousWorkoutFocus?: string | null;
}

function entryMatchesTarget(entry: TimelineEntry, target: TimelineEntry): boolean {
  if (target.workoutLogId && entry.workoutLogId === target.workoutLogId) return true;
  if (target.planDayId && entry.planDayId === target.planDayId) return true;
  return entry.id === target.id;
}

function patchTimelineTitle(
  entries: TimelineEntry[] | undefined,
  target: TimelineEntry,
  title: string,
): TimelineEntry[] | undefined {
  if (!entries) return entries;
  return entries.map((entry) =>
    entryMatchesTarget(entry, target) ? { ...entry, focus: title } : entry,
  );
}

function rollbackTimelineTitle(
  entries: TimelineEntry[] | undefined,
  target: TimelineEntry,
  optimisticTitle: string,
  rollbackTitle: string,
): TimelineEntry[] | undefined {
  if (!entries) return entries;
  return entries.map((entry) =>
    entryMatchesTarget(entry, target) && entry.focus === optimisticTitle
      ? { ...entry, focus: rollbackTitle }
      : entry,
  );
}

function patchOpenSurfaceTitles(
  setters: TimelineTitleMutationOptions,
  target: TimelineEntry,
  title: string,
): void {
  const patch = (entry: TimelineEntry | null) =>
    entry && entryMatchesTarget(entry, target) ? { ...entry, focus: title } : entry;
  setters.setPreviewEntry(patch);
  setters.setFutureEditEntry(patch);
  setters.setLogEntry(patch);
  setters.setReviewEntry(patch);
  setters.setSkippedEntry(patch);
}

function rollbackOpenSurfaceTitles(
  setters: TimelineTitleMutationOptions,
  target: TimelineEntry,
  optimisticTitle: string,
  rollbackTitle: string,
): void {
  const patch = (entry: TimelineEntry | null) =>
    entry && entryMatchesTarget(entry, target) && entry.focus === optimisticTitle
      ? { ...entry, focus: rollbackTitle }
      : entry;
  setters.setPreviewEntry(patch);
  setters.setFutureEditEntry(patch);
  setters.setLogEntry(patch);
  setters.setReviewEntry(patch);
  setters.setSkippedEntry(patch);
}

function getRenameTargetKey(entry: TimelineEntry): string | null {
  if (entry.workoutLogId) return `workout:${entry.workoutLogId}`;
  if (entry.planDayId) return `plan-day:${entry.planDayId}`;
  return entry.id ? `entry:${entry.id}` : null;
}

function updatePendingCount(
  setPendingCounts: Dispatch<SetStateAction<Map<string, number>>>,
  key: string | null,
  delta: number,
): void {
  if (!key) return;
  setPendingCounts((current) => {
    const next = new Map(current);
    const count = (next.get(key) ?? 0) + delta;
    if (count > 0) {
      next.set(key, count);
    } else {
      next.delete(key);
    }
    return next;
  });
}

export function useTimelineTitleMutation(setters: TimelineTitleMutationOptions) {
  const [pendingCounts, setPendingCounts] = useState<Map<string, number>>(() => new Map());
  const mutation = useApiMutation<unknown, Error, RenameTimelineTitleVariables, RenameTimelineTitleContext>({
    mutationFn: async ({ entry, title }) => {
      if (entry.workoutLogId) {
        return api.workouts.update(entry.workoutLogId, { focus: title });
      }
      if (entry.planDayId) {
        return api.plans.updateDayWithoutPlan(entry.planDayId, { focus: title });
      }
      throw new Error("Cannot rename an entry without a workout log or plan day");
    },
    invalidateQueries: [QUERY_KEYS.timeline, QUERY_KEYS.workouts, QUERY_KEYS.plans],
    onMutate: async ({ entry, title }) => {
      const targetKey = getRenameTargetKey(entry);
      updatePendingCount(setPendingCounts, targetKey, 1);
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.timeline });
      const previousWorkoutFocus = entry.workoutLogId
        ? queryClient.getQueryData<WorkoutLog>(QUERY_KEYS.workout(entry.workoutLogId))?.focus
        : undefined;

      queryClient.setQueriesData<TimelineEntry[]>({ queryKey: QUERY_KEYS.timeline }, (current) =>
        patchTimelineTitle(current, entry, title),
      );
      if (entry.workoutLogId) {
        queryClient.setQueryData<WorkoutLog>(QUERY_KEYS.workout(entry.workoutLogId), (current) =>
          current ? { ...current, focus: title } : current,
        );
      }
      patchOpenSurfaceTitles(setters, entry, title);

      return { targetKey, previousWorkoutFocus };
    },
    onError: (_error, { entry, title }, context) => {
      queryClient.setQueriesData<TimelineEntry[]>({ queryKey: QUERY_KEYS.timeline }, (current) =>
        rollbackTimelineTitle(current, entry, title, entry.focus),
      );
      if (entry.workoutLogId) {
        queryClient.setQueryData<WorkoutLog>(QUERY_KEYS.workout(entry.workoutLogId), (current) =>
          current && current.focus === title
            ? { ...current, focus: context?.previousWorkoutFocus ?? entry.focus }
            : current,
        );
      }
      rollbackOpenSurfaceTitles(setters, entry, title, entry.focus);
    },
    onSettled: (_data, _error, variables, context) => {
      updatePendingCount(setPendingCounts, context?.targetKey ?? getRenameTargetKey(variables.entry), -1);
    },
    errorToast: "Couldn't save title",
  });

  const isRenamingEntry = useCallback(
    (entry: TimelineEntry | null) => {
      if (!entry) return false;
      const key = getRenameTargetKey(entry);
      return !!key && (pendingCounts.get(key) ?? 0) > 0;
    },
    [pendingCounts],
  );

  return {
    ...mutation,
    isRenamingEntry,
  };
}

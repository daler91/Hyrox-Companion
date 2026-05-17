import type { TimelineEntry, WorkoutLog } from "@shared/schema";
import type { QueryKey } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";

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
  readonly previousTimelineQueries: Array<[QueryKey, TimelineEntry[] | undefined]>;
  readonly previousWorkout?: WorkoutLog;
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

export function useTimelineTitleMutation(setters: TimelineTitleMutationOptions) {
  return useApiMutation<unknown, Error, RenameTimelineTitleVariables, RenameTimelineTitleContext>({
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
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.timeline });
      const previousTimelineQueries =
        queryClient.getQueriesData<TimelineEntry[]>({ queryKey: QUERY_KEYS.timeline });
      const previousWorkout = entry.workoutLogId
        ? queryClient.getQueryData<WorkoutLog>(QUERY_KEYS.workout(entry.workoutLogId))
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

      return { previousTimelineQueries, previousWorkout };
    },
    onError: (_error, { entry }, context) => {
      context?.previousTimelineQueries.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      if (entry.workoutLogId && context?.previousWorkout) {
        queryClient.setQueryData(QUERY_KEYS.workout(entry.workoutLogId), context.previousWorkout);
      }
      patchOpenSurfaceTitles(setters, entry, entry.focus);
    },
    errorToast: "Couldn't save title",
  });
}

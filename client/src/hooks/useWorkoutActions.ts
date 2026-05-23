import { type TimelineEntry, type WorkoutStatus } from "@shared/schema";
import { useCallback, useState } from "react";

import { isTimelineEntryBulkDeletable } from "./workout-actions/bulkDelete";
import {
  buildLoggedTimelineEntry,
  useWorkoutActionMutations,
} from "./workout-actions/useWorkoutActionMutations";

interface MarkCompleteOptions {
  readonly onSuccess?: (entry: TimelineEntry) => void;
  readonly onError?: (error: Error) => void;
}


export function useWorkoutActions(selectedPlanId: string | null) {
  const [skipConfirmEntry, setSkipConfirmEntry] = useState<TimelineEntry | null>(null);
  const {
    updateStatusMutation,
    logWorkoutMutation,
    deleteWorkoutMutation,
    deletePlanDayMutation,
    bulkDeleteWorkoutMutation,
  } = useWorkoutActionMutations(selectedPlanId);

  const handleMarkComplete = useCallback(
    (entry: TimelineEntry, options?: MarkCompleteOptions) => {
      if (!entry.planDayId) {
        options?.onError?.(new Error("Cannot complete a workout without a plan day"));
        return;
      }
      logWorkoutMutation.mutate({
        planDayId: entry.planDayId,
        date: entry.date,
        focus: entry.focus,
        mainWorkout: entry.mainWorkout,
        accessory: entry.accessory || undefined,
        notes: entry.notes || undefined,
        rpe: entry.rpe ?? undefined,
        sourceEntry: entry,
      }, {
        onSuccess: (workout) => {
          options?.onSuccess?.(buildLoggedTimelineEntry(workout, entry));
        },
        onError: (error) => {
          options?.onError?.(error instanceof Error ? error : new Error("Failed to log workout"));
        },
      });
    },
    [logWorkoutMutation],
  );

  const handleSkip = useCallback((entry: TimelineEntry) => {
    setSkipConfirmEntry(entry);
  }, []);

  const confirmSkip = useCallback(() => {
    if (!skipConfirmEntry?.planDayId) return;
    updateStatusMutation.mutate({
      dayId: skipConfirmEntry.planDayId,
      status: "skipped",
    });
    setSkipConfirmEntry(null);
  }, [skipConfirmEntry, updateStatusMutation]);

  const handleChangeStatus = useCallback(
    (entry: TimelineEntry, status: WorkoutStatus) => {
      if (!entry.planDayId) return;
      updateStatusMutation.mutate({ dayId: entry.planDayId, status });
    },
    [updateStatusMutation],
  );

  const handleDelete = useCallback(
    (entry: TimelineEntry) => {
      if (entry.workoutLogId && !entry.planDayId) {
        deleteWorkoutMutation.mutate(entry.workoutLogId);
      } else if (entry.planDayId) {
        deletePlanDayMutation.mutate(entry.planDayId);
      }
    },
    [deleteWorkoutMutation, deletePlanDayMutation],
  );

  const handleBulkDelete = useCallback(
    (entries: TimelineEntry[]) => {
      const deletableEntries = entries.filter(isTimelineEntryBulkDeletable);
      if (deletableEntries.length === 0) return;
      bulkDeleteWorkoutMutation.mutate(deletableEntries);
    },
    [bulkDeleteWorkoutMutation],
  );

  return {
    skipConfirmEntry,
    setSkipConfirmEntry,
    handleMarkComplete,
    handleSkip,
    confirmSkip,
    handleChangeStatus,
    handleDelete,
    handleBulkDelete,
    updateStatusMutation,
    logWorkoutMutation,
    deleteWorkoutMutation,
    deletePlanDayMutation,
    bulkDeleteWorkoutMutation,
  };
}

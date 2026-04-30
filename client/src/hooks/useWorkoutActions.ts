import { type TimelineEntry, type WorkoutStatus } from "@shared/schema";
import { useCallback, useState } from "react";

import { useWorkoutActionMutations } from "./workout-actions/useWorkoutActionMutations";

export function useWorkoutActions(selectedPlanId: string | null) {
  const [skipConfirmEntry, setSkipConfirmEntry] = useState<TimelineEntry | null>(null);
  const {
    updateStatusMutation,
    logWorkoutMutation,
    deleteWorkoutMutation,
    deletePlanDayMutation,
  } = useWorkoutActionMutations(selectedPlanId);

  const handleMarkComplete = useCallback(
    (entry: TimelineEntry) => {
      if (!entry.planDayId) return;
      logWorkoutMutation.mutate({
        planDayId: entry.planDayId,
        date: entry.date,
        focus: entry.focus,
        mainWorkout: entry.mainWorkout,
        accessory: entry.accessory || undefined,
        notes: entry.notes || undefined,
        rpe: entry.rpe ?? undefined,
        sourceEntry: entry,
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

  return {
    skipConfirmEntry,
    setSkipConfirmEntry,
    handleMarkComplete,
    handleSkip,
    confirmSkip,
    handleChangeStatus,
    handleDelete,
    updateStatusMutation,
    logWorkoutMutation,
    deleteWorkoutMutation,
    deletePlanDayMutation,
  };
}

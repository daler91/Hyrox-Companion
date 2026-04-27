import { type TimelineEntry, type WorkoutStatus } from "@shared/schema";
import { useCallback, useState } from "react";

import type { SaveFromDetailUpdates } from "./workout-actions/types";
import { useTimelineDetailEntry } from "./workout-actions/useTimelineDetailEntry";
import { useWorkoutActionMutations } from "./workout-actions/useWorkoutActionMutations";

export function useWorkoutActions(
  selectedPlanId: string | null,
  timelineData: TimelineEntry[] = [],
) {
  const [skipConfirmEntry, setSkipConfirmEntry] = useState<TimelineEntry | null>(null);
  const { detailEntry, setDetailEntry } = useTimelineDetailEntry(timelineData);
  const {
    updateStatusMutation,
    updateDayMutation,
    logWorkoutMutation,
    updateWorkoutMutation,
    deleteWorkoutMutation,
    deletePlanDayMutation,
  } = useWorkoutActionMutations(selectedPlanId, setDetailEntry);

  const openDetailDialog = useCallback(
    (entry: TimelineEntry) => {
      setDetailEntry(entry);
    },
    [setDetailEntry],
  );

  const handleSaveFromDetail = useCallback(
    (updates: SaveFromDetailUpdates) => {
      if (!detailEntry) return;

      if (detailEntry.workoutLogId) {
        updateWorkoutMutation.mutate({
          workoutId: detailEntry.workoutLogId,
          updates: { ...updates, exercises: updates.exercises },
        });
        return;
      }

      if (!detailEntry.planDayId) return;

      const hasExercises = updates.exercises && updates.exercises.length > 0;
      const hasWorkoutLogFields = updates.rpe != null;

      if (hasExercises || hasWorkoutLogFields) {
        logWorkoutMutation.mutate({
          planDayId: detailEntry.planDayId,
          date: detailEntry.date,
          focus: updates.focus,
          mainWorkout: updates.mainWorkout,
          accessory: updates.accessory || undefined,
          notes: updates.notes || undefined,
          rpe: updates.rpe ?? undefined,
          exercises: updates.exercises,
          sourceEntry: detailEntry,
        });
        return;
      }

      updateDayMutation.mutate({
        dayId: detailEntry.planDayId,
        updates,
      });
    },
    [detailEntry, updateWorkoutMutation, logWorkoutMutation, updateDayMutation],
  );

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
    detailEntry,
    setDetailEntry,
    skipConfirmEntry,
    setSkipConfirmEntry,
    openDetailDialog,
    handleSaveFromDetail,
    handleMarkComplete,
    handleSkip,
    confirmSkip,
    handleChangeStatus,
    handleDelete,
    updateStatusMutation,
    updateDayMutation,
    logWorkoutMutation,
    updateWorkoutMutation,
    deleteWorkoutMutation,
    deletePlanDayMutation,
  };
}

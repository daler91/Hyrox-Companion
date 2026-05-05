import { type ParsedExercise, type TimelineEntry, type WorkoutStatus } from "@shared/schema";
import { useCallback, useState } from "react";

import { useWorkoutActionMutations } from "./workout-actions/useWorkoutActionMutations";


function toParsedExercises(entry: TimelineEntry): ParsedExercise[] | undefined {
  const rows = entry.exerciseSets ?? [];
  if (rows.length === 0) return undefined;

  const grouped = new Map<string, ParsedExercise>();
  for (const set of rows) {
    const key = `${set.exerciseName}::${set.customLabel ?? ""}`;
    const existing = grouped.get(key);
    const setPayload = {
      setNumber: set.setNumber,
      reps: set.reps ?? undefined,
      weight: set.weight ?? undefined,
      distance: set.distance ?? undefined,
      time: set.time ?? undefined,
      plannedReps: set.plannedReps ?? undefined,
      plannedWeight: set.plannedWeight ?? undefined,
      plannedDistance: set.plannedDistance ?? undefined,
      plannedTime: set.plannedTime ?? undefined,
      notes: set.notes ?? undefined,
    };

    if (existing) {
      existing.sets.push(setPayload);
      continue;
    }

    grouped.set(key, {
      exerciseName: set.exerciseName,
      customLabel: set.customLabel ?? undefined,
      category: set.category,
      confidence: set.confidence ?? undefined,
      sets: [setPayload],
    });
  }

  return Array.from(grouped.values());
}

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
        exercises: toParsedExercises(entry),
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

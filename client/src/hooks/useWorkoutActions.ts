import {
  type ParsedExercise,
  type TimelineEntry,
  type PlanDay,
  type WorkoutStatus,
  type UpdateWorkoutLog,
  type User,
} from "@shared/schema";
import { useState, useCallback } from "react";
import { queryClient } from "@/lib/queryClient";
import { api, QUERY_KEYS } from "@/lib/api";
import { useApiMutation } from "./useApiMutation";

export function useWorkoutActions(selectedPlanId: string | null) {
  const [detailEntry, setDetailEntry] = useState<TimelineEntry | null>(null);
  const [skipConfirmEntry, setSkipConfirmEntry] = useState<TimelineEntry | null>(null);

  const updateStatusMutation = useApiMutation({
    mutationFn: ({ dayId, status }: { dayId: string; status: string }) =>
      api.plans.updateDayStatus(dayId, status),
    invalidateQueries: [QUERY_KEYS.timeline],
    successToast: "Status updated",
    errorToast: "Failed to update status",
    onMutate: async ({ dayId, status }) => {
      await queryClient.cancelQueries({ queryKey: [...QUERY_KEYS.timeline, selectedPlanId] });
      const previousTimeline = queryClient.getQueryData<TimelineEntry[]>([
        ...QUERY_KEYS.timeline,
        selectedPlanId,
      ]);

      if (previousTimeline) {
        queryClient.setQueryData<TimelineEntry[]>(
          [...QUERY_KEYS.timeline, selectedPlanId],
          (old) => {
            if (!old) return old;
            return old.map((entry) =>
              entry.planDayId === dayId ? { ...entry, status: status as WorkoutStatus } : entry,
            );
          },
        );
      }

      return { previousTimeline };
    },
    onError: (err, variables, context: { previousTimeline?: TimelineEntry[] } | undefined) => {
      if (context?.previousTimeline) {
        queryClient.setQueryData(
          [...QUERY_KEYS.timeline, selectedPlanId],
          context.previousTimeline,
        );
      }
    },
    onSuccess: (data, variables) => {
      if (variables.status === "completed") {
        queryClient.setQueryData<User | null>([...QUERY_KEYS.authUser], (old) => {
          if (!old) return old;
          return { ...old, isAutoCoaching: true };
        });
      }
    },
  });

  const updateDayMutation = useApiMutation({
    mutationFn: ({ dayId, updates }: { dayId: string; updates: Partial<PlanDay> }) =>
      api.plans.updateDay(selectedPlanId!, dayId, updates),
    invalidateQueries: [QUERY_KEYS.timeline],
    successToast: "Entry updated",
    errorToast: "Failed to update entry",
    onSuccess: () => {
      setDetailEntry(null);
    },
  });

  const logWorkoutMutation = useApiMutation({
    mutationFn: (data: {
      planDayId: string;
      date: string;
      focus: string;
      mainWorkout: string;
      accessory?: string;
      notes?: string;
      rpe?: number;
      exercises?: ParsedExercise[];
    }) => api.workouts.create(data),
    invalidateQueries: [QUERY_KEYS.timeline],
    successToast: "Workout logged!",
    errorToast: "Failed to log workout",
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: [...QUERY_KEYS.timeline, selectedPlanId] });
      const previousTimeline = queryClient.getQueryData<TimelineEntry[]>([
        ...QUERY_KEYS.timeline,
        selectedPlanId,
      ]);

      if (previousTimeline) {
        queryClient.setQueryData<TimelineEntry[]>(
          [...QUERY_KEYS.timeline, selectedPlanId],
          (old) => {
            if (!old) return old;
            return old.map((entry) =>
              entry.planDayId === variables.planDayId
                ? { ...entry, status: "completed" as WorkoutStatus }
                : entry,
            );
          },
        );
      }

      return { previousTimeline };
    },
    onError: (err, variables, context: { previousTimeline?: TimelineEntry[] } | undefined) => {
      if (context?.previousTimeline) {
        queryClient.setQueryData(
          [...QUERY_KEYS.timeline, selectedPlanId],
          context.previousTimeline,
        );
      }
    },
    onSuccess: () => {
      queryClient.setQueryData<User | null>([...QUERY_KEYS.authUser], (old) => {
        if (!old) return old;
        return { ...old, isAutoCoaching: true };
      });
      setDetailEntry(null);
    },
  });

  const updateWorkoutMutation = useApiMutation({
    mutationFn: ({
      workoutId,
      updates,
    }: {
      workoutId: string;
      updates: UpdateWorkoutLog & { exercises?: ParsedExercise[] };
    }) => api.workouts.update(workoutId, updates),
    invalidateQueries: [QUERY_KEYS.timeline, QUERY_KEYS.workouts],
    successToast: "Workout updated",
    errorToast: "Failed to update workout",
    onSuccess: () => {
      setDetailEntry(null);
    },
  });

  const deleteWorkoutMutation = useApiMutation({
    mutationFn: (workoutId: string) => api.workouts.delete(workoutId),
    invalidateQueries: [QUERY_KEYS.timeline, QUERY_KEYS.workouts],
    successToast: "Workout deleted",
    errorToast: "Failed to delete workout",
    onMutate: async (workoutId) => {
      await queryClient.cancelQueries({ queryKey: [...QUERY_KEYS.timeline, selectedPlanId] });
      const previousTimeline = queryClient.getQueryData<TimelineEntry[]>([
        ...QUERY_KEYS.timeline,
        selectedPlanId,
      ]);

      if (previousTimeline) {
        queryClient.setQueryData<TimelineEntry[]>(
          [...QUERY_KEYS.timeline, selectedPlanId],
          (old) => {
            if (!old) return old;
            return old.filter((entry) => entry.workoutLogId !== workoutId);
          },
        );
      }

      return { previousTimeline };
    },
    onError: (err, variables, context: { previousTimeline?: TimelineEntry[] } | undefined) => {
      if (context?.previousTimeline) {
        queryClient.setQueryData(
          [...QUERY_KEYS.timeline, selectedPlanId],
          context.previousTimeline,
        );
      }
    },
    onSuccess: () => {
      setDetailEntry(null);
    },
  });

  const deletePlanDayMutation = useApiMutation({
    mutationFn: (dayId: string) => api.plans.deleteDay(dayId),
    invalidateQueries: [QUERY_KEYS.timeline, QUERY_KEYS.plans],
    successToast: "Workout removed from plan",
    errorToast: "Failed to delete workout",
    onMutate: async (dayId) => {
      await queryClient.cancelQueries({ queryKey: [...QUERY_KEYS.timeline, selectedPlanId] });
      const previousTimeline = queryClient.getQueryData<TimelineEntry[]>([
        ...QUERY_KEYS.timeline,
        selectedPlanId,
      ]);

      if (previousTimeline) {
        queryClient.setQueryData<TimelineEntry[]>(
          [...QUERY_KEYS.timeline, selectedPlanId],
          (old) => {
            if (!old) return old;
            return old.filter((entry) => entry.planDayId !== dayId);
          },
        );
      }

      return { previousTimeline };
    },
    onError: (err, variables, context: { previousTimeline?: TimelineEntry[] } | undefined) => {
      if (context?.previousTimeline) {
        queryClient.setQueryData(
          [...QUERY_KEYS.timeline, selectedPlanId],
          context.previousTimeline,
        );
      }
    },
    onSuccess: () => {
      setDetailEntry(null);
    },
  });

  const openDetailDialog = useCallback((entry: TimelineEntry) => {
    setDetailEntry(entry);
  }, []);

  const handleSaveFromDetail = useCallback(
    (updates: {
      focus: string;
      mainWorkout: string;
      accessory: string | null;
      notes: string | null;
      rpe?: number | null;
      exercises?: ParsedExercise[];
    }) => {
      if (!detailEntry) return;

      if (detailEntry.workoutLogId) {
        updateWorkoutMutation.mutate({
          workoutId: detailEntry.workoutLogId,
          updates: { ...updates, exercises: updates.exercises },
        });
        return;
      }

      if (!detailEntry.planDayId) return;

      if (updates.exercises && updates.exercises.length > 0) {
        logWorkoutMutation.mutate({
          planDayId: detailEntry.planDayId,
          date: detailEntry.date,
          focus: updates.focus,
          mainWorkout: updates.mainWorkout,
          accessory: updates.accessory || undefined,
          notes: updates.notes || undefined,
          rpe: updates.rpe ?? undefined,
          exercises: updates.exercises,
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
      });
    },
    [logWorkoutMutation],
  );

  const handleSkip = useCallback((entry: TimelineEntry) => {
    setSkipConfirmEntry(entry);
  }, []);

  const confirmSkip = useCallback(() => {
    if (!skipConfirmEntry?.planDayId) return;
    updateStatusMutation.mutate({ dayId: skipConfirmEntry.planDayId, status: "skipped" });
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

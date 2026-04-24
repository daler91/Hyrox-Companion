import { type ParsedExercise, type PlanDay, type TimelineEntry, type UpdateWorkoutLog, type User,type WorkoutStatus } from "@shared/schema";
import { useCallback, useMemo, useState } from "react";

import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

import { useApiMutation } from "./useApiMutation";
import { useOpenWorkoutId } from "./useOpenWorkoutId";

function entryId(entry: TimelineEntry): string | null {
  return entry.workoutLogId ?? entry.planDayId ?? null;
}

/**
 * Shared plumbing for optimistic timeline mutations: cancel in-flight
 * queries, snapshot the previous state, apply the optimistic update, and
 * return a rollback context. Keeps the 4 mutations below from each
 * re-implementing the same cancel/snapshot/rollback dance.
 */
function buildOptimisticTimelineHandlers<TVariables>(
  selectedPlanId: string | null,
  mutate: (entries: TimelineEntry[], variables: TVariables) => TimelineEntry[],
) {
  const queryKey = [...QUERY_KEYS.timeline, selectedPlanId];
  return {
    onMutate: async (variables: TVariables) => {
      await queryClient.cancelQueries({ queryKey });
      const previousTimeline = queryClient.getQueryData<TimelineEntry[]>(queryKey);
      if (previousTimeline) {
        queryClient.setQueryData<TimelineEntry[]>(queryKey, (old) => {
          if (!old) return old;
          return mutate(old, variables);
        });
      }
      return { previousTimeline };
    },
    onError: (_err: Error, _variables: TVariables, context: { previousTimeline?: TimelineEntry[] } | undefined) => {
      if (context?.previousTimeline) {
        queryClient.setQueryData(queryKey, context.previousTimeline);
      }
    },
  };
}

export function useWorkoutActions(
  selectedPlanId: string | null,
  timelineData: TimelineEntry[] = [],
) {
  const { openWorkoutId, setOpenWorkoutId } = useOpenWorkoutId();
  // Locally cache the entry passed into openDetailDialog so the dialog can
  // render immediately from the click handler's data, even if the URL is the
  // source of truth. On a deep link / refresh the cache is empty and we fall
  // back to looking up the id in timelineData.
  const [cachedEntry, setCachedEntry] = useState<TimelineEntry | null>(null);
  const [skipConfirmEntry, setSkipConfirmEntry] = useState<TimelineEntry | null>(null);

  const detailEntry = useMemo<TimelineEntry | null>(() => {
    if (!openWorkoutId) return null;
    if (cachedEntry && entryId(cachedEntry) === openWorkoutId) return cachedEntry;
    return timelineData.find((e) => entryId(e) === openWorkoutId) ?? null;
  }, [openWorkoutId, cachedEntry, timelineData]);

  const setDetailEntry = useCallback(
    (entry: TimelineEntry | null) => {
      setCachedEntry(entry);
      setOpenWorkoutId(entry ? entryId(entry) : null);
    },
    [setOpenWorkoutId],
  );

  const updateStatusHandlers = buildOptimisticTimelineHandlers<{ dayId: string; status: string }>(
    selectedPlanId,
    (old, { dayId, status }) =>
      old.map((entry) =>
        entry.planDayId === dayId
          ? { ...entry, status: status as WorkoutStatus }
          : entry,
      ),
  );
  const updateStatusMutation = useApiMutation({
    mutationFn: ({ dayId, status }: { dayId: string; status: string }) =>
      api.plans.updateDayStatus(dayId, status),
    invalidateQueries: [QUERY_KEYS.timeline],
    successToast: "Status updated",
    errorToast: "Failed to update status",
    ...updateStatusHandlers,
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

  type LogWorkoutVariables = { planDayId: string; date: string; focus: string; mainWorkout: string; accessory?: string; notes?: string; rpe?: number; exercises?: ParsedExercise[] };
  const logWorkoutHandlers = buildOptimisticTimelineHandlers<LogWorkoutVariables>(
    selectedPlanId,
    (old, variables) =>
      old.map((entry) =>
        entry.planDayId === variables.planDayId
          ? { ...entry, status: "completed" as WorkoutStatus }
          : entry,
      ),
  );
  const logWorkoutMutation = useApiMutation({
    mutationFn: (data: LogWorkoutVariables) => api.workouts.create(data),
    // 🧠 New workouts can set new PRs / extend analytics series — invalidate
    // so ExerciseProgressionTab + PersonalRecordsTab (staleTime: Infinity)
    // refresh. (CODEBASE_REVIEW_2026-04-12.md #27)
    invalidateQueries: [QUERY_KEYS.timeline, QUERY_KEYS.personalRecords, QUERY_KEYS.exerciseAnalytics],
    successToast: "Workout logged!",
    errorToast: "Failed to log workout",
    ...logWorkoutHandlers,
    onSuccess: () => {
      queryClient.setQueryData<User | null>([...QUERY_KEYS.authUser], (old) => {
        if (!old) return old;
        return { ...old, isAutoCoaching: true };
      });
      setDetailEntry(null);
    },
  });

  type UpdateWorkoutVariables = { workoutId: string; updates: UpdateWorkoutLog & { exercises?: ParsedExercise[] } };
  const updateWorkoutHandlers = buildOptimisticTimelineHandlers<UpdateWorkoutVariables>(
    selectedPlanId,
    (old, { workoutId, updates }) =>
      old.map((entry) =>
        entry.workoutLogId === workoutId
          ? {
              ...entry,
              ...updates.focus != null && { focus: updates.focus },
              ...updates.mainWorkout != null && { mainWorkout: updates.mainWorkout },
              ...updates.accessory !== undefined && { accessory: updates.accessory },
              ...updates.notes !== undefined && { notes: updates.notes },
              ...updates.rpe !== undefined && { rpe: updates.rpe },
            }
          : entry,
      ),
  );
  const updateWorkoutMutation = useApiMutation({
    mutationFn: ({ workoutId, updates }: UpdateWorkoutVariables) =>
      api.workouts.update(workoutId, updates),
    invalidateQueries: [QUERY_KEYS.timeline, QUERY_KEYS.workouts, QUERY_KEYS.personalRecords, QUERY_KEYS.exerciseAnalytics],
    successToast: "Workout updated",
    errorToast: "Failed to update workout",
    ...updateWorkoutHandlers,
    onSuccess: () => {
      setDetailEntry(null);
    },
  });

  const deleteWorkoutHandlers = buildOptimisticTimelineHandlers<string>(
    selectedPlanId,
    (old, workoutId) => old.filter((entry) => entry.workoutLogId !== workoutId),
  );
  const deleteWorkoutMutation = useApiMutation({
    mutationFn: (workoutId: string) => api.workouts.delete(workoutId),
    invalidateQueries: [QUERY_KEYS.timeline, QUERY_KEYS.workouts, QUERY_KEYS.personalRecords, QUERY_KEYS.exerciseAnalytics],
    successToast: "Workout deleted",
    errorToast: "Failed to delete workout",
    ...deleteWorkoutHandlers,
    onSuccess: () => {
      setDetailEntry(null);
    },
  });

  const deletePlanDayHandlers = buildOptimisticTimelineHandlers<string>(
    selectedPlanId,
    (old, dayId) => old.filter((entry) => entry.planDayId !== dayId),
  );
  const deletePlanDayMutation = useApiMutation({
    mutationFn: (dayId: string) => api.plans.deleteDay(dayId),
    invalidateQueries: [QUERY_KEYS.timeline, QUERY_KEYS.plans],
    successToast: "Workout removed from plan",
    errorToast: "Failed to delete workout",
    ...deletePlanDayHandlers,
    onSuccess: () => {
      setDetailEntry(null);
    },
  });

  const openDetailDialog = useCallback(
    (entry: TimelineEntry) => {
      setDetailEntry(entry);
    },
    [setDetailEntry],
  );

  const handleSaveFromDetail = useCallback((updates: { focus: string; mainWorkout: string; accessory: string | null; notes: string | null; rpe?: number | null; exercises?: ParsedExercise[] }) => {
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
      });
      return;
    }

    updateDayMutation.mutate({
      dayId: detailEntry.planDayId,
      updates,
    });
  }, [detailEntry, updateWorkoutMutation, logWorkoutMutation, updateDayMutation]);

  const handleMarkComplete = useCallback((entry: TimelineEntry) => {
    if (!entry.planDayId) return;
    logWorkoutMutation.mutate({
      planDayId: entry.planDayId,
      date: entry.date,
      focus: entry.focus,
      mainWorkout: entry.mainWorkout,
      accessory: entry.accessory || undefined,
      notes: entry.notes || undefined,
      rpe: entry.rpe ?? undefined,
    });
  }, [logWorkoutMutation]);

  const handleSkip = useCallback((entry: TimelineEntry) => {
    setSkipConfirmEntry(entry);
  }, []);

  const confirmSkip = useCallback(() => {
    if (!skipConfirmEntry?.planDayId) return;
    updateStatusMutation.mutate({ dayId: skipConfirmEntry.planDayId, status: "skipped" });
    setSkipConfirmEntry(null);
  }, [skipConfirmEntry, updateStatusMutation]);

  const handleChangeStatus = useCallback((entry: TimelineEntry, status: WorkoutStatus) => {
    if (!entry.planDayId) return;
    updateStatusMutation.mutate({ dayId: entry.planDayId, status });
  }, [updateStatusMutation]);

  const handleDelete = useCallback((entry: TimelineEntry) => {
    if (entry.workoutLogId && !entry.planDayId) {
      deleteWorkoutMutation.mutate(entry.workoutLogId);
    } else if (entry.planDayId) {
      deletePlanDayMutation.mutate(entry.planDayId);
    }
  }, [deleteWorkoutMutation, deletePlanDayMutation]);

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

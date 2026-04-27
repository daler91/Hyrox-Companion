import type { TimelineEntry, User, WorkoutStatus } from "@shared/schema";

import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

import { useApiMutation } from "../useApiMutation";
import { buildOptimisticTimelineHandlers } from "./optimisticTimeline";
import type {
  LogWorkoutVariables,
  UpdateDayVariables,
  UpdateStatusVariables,
  UpdateWorkoutVariables,
} from "./types";

function markAutoCoachingActive() {
  queryClient.setQueryData<User | null>([...QUERY_KEYS.authUser], (old) => {
    if (!old) return old;
    return { ...old, isAutoCoaching: true };
  });
}

export function useWorkoutActionMutations(
  selectedPlanId: string | null,
  setDetailEntry: (entry: TimelineEntry | null) => void,
) {
  const updateStatusHandlers = buildOptimisticTimelineHandlers<UpdateStatusVariables>(
    selectedPlanId,
    (old, { dayId, status }) =>
      old.map((entry) =>
        entry.planDayId === dayId ? { ...entry, status: status as WorkoutStatus } : entry,
      ),
  );
  const updateStatusMutation = useApiMutation({
    mutationFn: ({ dayId, status }: UpdateStatusVariables) =>
      api.plans.updateDayStatus(dayId, status),
    invalidateQueries: [QUERY_KEYS.timeline],
    successToast: "Status updated",
    errorToast: "Failed to update status",
    ...updateStatusHandlers,
    onSuccess: (_data, variables) => {
      if (variables.status === "completed") {
        markAutoCoachingActive();
      }
    },
  });

  const updateDayMutation = useApiMutation({
    mutationFn: ({ dayId, updates }: UpdateDayVariables) =>
      api.plans.updateDay(selectedPlanId!, dayId, updates),
    invalidateQueries: [QUERY_KEYS.timeline],
    successToast: "Entry updated",
    errorToast: "Failed to update entry",
    onSuccess: () => {
      setDetailEntry(null);
    },
  });

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
    // New workouts can set new PRs / extend analytics series. Keep the
    // staleTime: Infinity analytics tabs fresh after mutation success.
    invalidateQueries: [
      QUERY_KEYS.timeline,
      QUERY_KEYS.personalRecords,
      QUERY_KEYS.exerciseAnalytics,
    ],
    successToast: "Workout logged!",
    errorToast: "Failed to log workout",
    ...logWorkoutHandlers,
    onSuccess: (data, variables) => {
      markAutoCoachingActive();
      // Patch the cached timeline entry with the freshly-created
      // workoutLogId so the detail dialog can stay open and re-render in
      // logged state. entryId() prefers workoutLogId over planDayId, so
      // without rebinding the URL the dialog's openWorkoutId (still the
      // planDayId) no longer matches any entry and the dialog closes.
      const queryKey = [...QUERY_KEYS.timeline, selectedPlanId];
      let updatedEntry: TimelineEntry | null = null;
      queryClient.setQueryData<TimelineEntry[]>(queryKey, (old) => {
        if (!old) return old;
        return old.map((entry) => {
          if (entry.planDayId !== variables.planDayId) return entry;
          const next: TimelineEntry = { ...entry, workoutLogId: data.workout.id };
          updatedEntry = next;
          return next;
        });
      });
      if (updatedEntry) {
        setDetailEntry(updatedEntry);
      } else {
        setDetailEntry(null);
      }
    },
  });

  const updateWorkoutHandlers = buildOptimisticTimelineHandlers<UpdateWorkoutVariables>(
    selectedPlanId,
    (old, { workoutId, updates }) =>
      old.map((entry) =>
        entry.workoutLogId === workoutId
          ? {
              ...entry,
              ...(updates.focus != null && { focus: updates.focus }),
              ...(updates.mainWorkout != null && {
                mainWorkout: updates.mainWorkout,
              }),
              ...(updates.accessory !== undefined && {
                accessory: updates.accessory,
              }),
              ...(updates.notes !== undefined && { notes: updates.notes }),
              ...(updates.rpe !== undefined && { rpe: updates.rpe }),
            }
          : entry,
      ),
  );
  const updateWorkoutMutation = useApiMutation({
    mutationFn: ({ workoutId, updates }: UpdateWorkoutVariables) =>
      api.workouts.update(workoutId, updates),
    invalidateQueries: [
      QUERY_KEYS.timeline,
      QUERY_KEYS.workouts,
      QUERY_KEYS.personalRecords,
      QUERY_KEYS.exerciseAnalytics,
    ],
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
    invalidateQueries: [
      QUERY_KEYS.timeline,
      QUERY_KEYS.workouts,
      QUERY_KEYS.personalRecords,
      QUERY_KEYS.exerciseAnalytics,
    ],
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

  return {
    updateStatusMutation,
    updateDayMutation,
    logWorkoutMutation,
    updateWorkoutMutation,
    deleteWorkoutMutation,
    deletePlanDayMutation,
  };
}

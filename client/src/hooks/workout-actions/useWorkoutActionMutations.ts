import type { ExerciseSet, TimelineEntry, User, WorkoutLog, WorkoutStatus } from "@shared/schema";

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

type CreatedWorkout = WorkoutLog & { exerciseSets?: ExerciseSet[] };

function buildLoggedTimelineEntry(workout: CreatedWorkout, sourceEntry?: TimelineEntry | null): TimelineEntry {
  return {
    id: `log-${workout.id}`,
    date: workout.date ?? sourceEntry?.date ?? "",
    type: "logged",
    status: "completed",
    focus: workout.focus || sourceEntry?.focus || "Workout",
    mainWorkout: workout.mainWorkout ?? sourceEntry?.mainWorkout ?? "",
    accessory: workout.accessory ?? sourceEntry?.accessory ?? null,
    notes: workout.notes ?? sourceEntry?.notes ?? null,
    duration: workout.duration,
    rpe: workout.rpe,
    planDayId: workout.planDayId ?? sourceEntry?.planDayId ?? null,
    workoutLogId: workout.id,
    weekNumber: sourceEntry?.weekNumber,
    dayName: sourceEntry?.dayName,
    planName: sourceEntry?.planName,
    planId: workout.planId ?? sourceEntry?.planId ?? null,
    source: (workout.source as TimelineEntry["source"]) ?? sourceEntry?.source ?? "manual",
    aiSource: sourceEntry?.aiSource,
    aiRationale: sourceEntry?.aiRationale,
    aiNoteUpdatedAt: sourceEntry?.aiNoteUpdatedAt,
    aiInputsUsed: sourceEntry?.aiInputsUsed,
    exerciseSets: workout.exerciseSets ?? [],
    calories: workout.calories,
    distanceMeters: workout.distanceMeters,
    elevationGain: workout.elevationGain,
    avgHeartrate: workout.avgHeartrate,
    maxHeartrate: workout.maxHeartrate,
    avgSpeed: workout.avgSpeed,
    maxSpeed: workout.maxSpeed,
    avgCadence: workout.avgCadence,
    avgWatts: workout.avgWatts,
    sufferScore: workout.sufferScore,
  };
}

function patchTimelineEntriesForLoggedWorkout(
  workout: CreatedWorkout,
  variables: LogWorkoutVariables,
): TimelineEntry {
  let detailEntry = buildLoggedTimelineEntry(workout, variables.sourceEntry);

  queryClient.setQueriesData<TimelineEntry[]>({ queryKey: QUERY_KEYS.timeline }, (old) => {
    if (!old) return old;
    let patched = false;
    const nextEntries = old.map((entry) => {
      if (entry.planDayId !== variables.planDayId) return entry;
      patched = true;
      const nextEntry = buildLoggedTimelineEntry(workout, entry);
      detailEntry = nextEntry;
      return nextEntry;
    });
    return patched ? nextEntries : old;
  });

  return detailEntry;
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
    mutationFn: (data: LogWorkoutVariables) => {
      const { sourceEntry: _sourceEntry, ...payload } = data;
      return api.workouts.create(payload);
    },
    successToast: "Workout logged!",
    errorToast: "Failed to log workout",
    ...logWorkoutHandlers,
    onSuccess: async (data, variables) => {
      markAutoCoachingActive();
      // Prime the workout-detail cache so the in-dialog stepper renders
      // the seeded sets / RPE / notes immediately on its first paint —
      // without this, useWorkoutDetail(workoutId) starts loading and the
      // user sees an empty step 1 until the GET round-trip lands.
      queryClient.setQueryData(QUERY_KEYS.workout(data.id), data);
      setDetailEntry(patchTimelineEntriesForLoggedWorkout(data, variables));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.personalRecords }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.exerciseAnalytics }),
      ]);
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

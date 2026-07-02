import type { ExerciseSet, TimelineEntry, User, WorkoutLog, WorkoutStatus } from "@shared/schema";

import { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS } from "@/lib/api";
import { runWithOfflineFallback } from "@/lib/offlineMutationFallback";
import { toastPersonalRecordAchievements } from "@/lib/personalRecordAchievements";
import { queryClient } from "@/lib/queryClient";

import { useApiMutation } from "../useApiMutation";
import { buildBulkDeleteWorkoutTargets } from "./bulkDelete";
import { buildOptimisticTimelineHandlers } from "./optimisticTimeline";
import type {
  LogWorkoutVariables,
  UpdateStatusVariables,
} from "./types";

function markAutoCoachingActive() {
  queryClient.setQueryData<User | null>([...QUERY_KEYS.authUser], (old) => {
    if (!old) return old;
    return { ...old, isAutoCoaching: true };
  });
}

export type CreatedWorkout = WorkoutLog & { exerciseSets?: ExerciseSet[] };

export function buildLoggedTimelineEntry(workout: CreatedWorkout, sourceEntry?: TimelineEntry | null): TimelineEntry {
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

// Patches the timeline cache so the freshly-logged entry flips from
// `planned` to `completed` and gains its workoutLogId before the
// invalidate→refetch round-trip lands. Closing this gap stops a fast
// second tap on the same card from re-entering the planned path and
// submitting a duplicate log against the same plan day.
function patchTimelineEntriesForLoggedWorkout(
  workout: CreatedWorkout,
  variables: LogWorkoutVariables,
): void {
  queryClient.setQueriesData<TimelineEntry[]>({ queryKey: QUERY_KEYS.timeline }, (old) => {
    if (!old) return old;
    let patched = false;
    const nextEntries = old.map((entry) => {
      if (entry.planDayId !== variables.planDayId) return entry;
      patched = true;
      return buildLoggedTimelineEntry(workout, entry);
    });
    return patched ? nextEntries : old;
  });
}

export function useWorkoutActionMutations(selectedPlanId: string | null) {
  const { toast } = useToast();
  const updateStatusHandlers = buildOptimisticTimelineHandlers<UpdateStatusVariables>(
    selectedPlanId,
    (old, { dayId, status }) =>
      old.map((entry) =>
        entry.planDayId === dayId ? { ...entry, status: status as WorkoutStatus } : entry,
      ),
  );
  const updateStatusMutation = useApiMutation({
    // Queue-backed offline fallback: a queued PATCH resolves as a synthetic
    // success, so buildOptimisticTimelineHandlers' onError rollback never
    // fires and the optimistic status flip persists until the replay lands.
    // (In-session only — after a reload the flip reappears once the queue
    // syncs and the post-sync invalidation refetches.)
    mutationFn: ({ dayId, status }: UpdateStatusVariables) =>
      runWithOfflineFallback({
        method: "PATCH",
        url: `/api/v1/plans/days/${dayId}/status`,
        body: { status },
        perform: (idempotencyKey) =>
          api.plans.updateDayStatus(dayId, status, idempotencyKey ? { idempotencyKey } : undefined),
      }),
    successToast: (result) =>
      result.status === "queued"
        ? {
          title: "Status change queued",
          description: "We'll sync it automatically when your connection is back.",
        }
        : { title: "Status updated" },
    errorToast: "Failed to update status",
    ...updateStatusHandlers,
    onSuccess: async (result, variables) => {
      if (variables.status === "completed") {
        markAutoCoachingActive();
      }
      // Queued writes haven't reached the server — invalidating now would
      // (at best) refetch state without the change; the post-sync
      // invalidation covers them after replay.
      if (result.status !== "saved") return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trainingOverview }),
      ]);
    },
  });

  const logWorkoutHandlers = buildOptimisticTimelineHandlers<LogWorkoutVariables>(
    selectedPlanId,
    (old, variables) =>
      old.map((entry) =>
        entry.planDayId === variables.planDayId
          ? { ...entry, status: "completed" }
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
      // Prime the workout-detail cache so the ReviewSurface (mounted via
      // the URL→state effect after the timeline patch flips the entry to
      // completed + workoutLogId) renders seeded sets / RPE / notes
      // immediately on its first paint without waiting for the
      // useWorkoutDetail(workoutId) GET round-trip.
      queryClient.setQueryData(QUERY_KEYS.workout(data.id), data);
      patchTimelineEntriesForLoggedWorkout(data, variables);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.personalRecords }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.exerciseAnalytics }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trainingOverview }),
      ]);
      toastPersonalRecordAchievements(toast, data.newPersonalRecords);
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
      QUERY_KEYS.trainingOverview,
    ],
    successToast: "Workout deleted",
    errorToast: "Failed to delete workout",
    ...deleteWorkoutHandlers,
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
  });

  const bulkDeleteWorkoutHandlers = buildOptimisticTimelineHandlers<TimelineEntry[]>(
    selectedPlanId,
    (old, entries) => {
      const entryIds = new Set(entries.map((entry) => entry.id));
      const { workoutLogIds, planDayIds } = buildBulkDeleteWorkoutTargets(entries);
      const workoutLogIdSet = new Set(workoutLogIds);
      const planDayIdSet = new Set(planDayIds);

      return old.filter(
        (entry) =>
          !entryIds.has(entry.id) &&
          !(entry.workoutLogId && workoutLogIdSet.has(entry.workoutLogId)) &&
          !(entry.planDayId && planDayIdSet.has(entry.planDayId)),
      );
    },
  );
  const bulkDeleteWorkoutMutation = useApiMutation({
    mutationFn: (entries: TimelineEntry[]) => api.workouts.bulkDelete(buildBulkDeleteWorkoutTargets(entries)),
    invalidateQueries: [
      QUERY_KEYS.timeline,
      QUERY_KEYS.workouts,
      QUERY_KEYS.plans,
      QUERY_KEYS.personalRecords,
      QUERY_KEYS.exerciseAnalytics,
      QUERY_KEYS.trainingOverview,
    ],
    successToast: (data) => ({
      title: data.deletedCount === 1 ? "Workout removed" : `${data.deletedCount} workouts removed`,
    }),
    errorToast: "Failed to delete workouts",
    ...bulkDeleteWorkoutHandlers,
  });

  return {
    updateStatusMutation,
    logWorkoutMutation,
    deleteWorkoutMutation,
    deletePlanDayMutation,
    bulkDeleteWorkoutMutation,
  };
}

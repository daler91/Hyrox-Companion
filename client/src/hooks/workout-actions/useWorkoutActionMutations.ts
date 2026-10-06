import type { ExerciseSet, TimelineEntry, User, WorkoutLog, WorkoutStatus } from "@shared/schema";

import { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS } from "@/lib/api";
import { runWithOfflineFallback } from "@/lib/offlineMutationFallback";
import { WORKOUT_CREATE_URL } from "@/lib/pendingWorkouts";
import { toastPersonalRecordAchievements } from "@/lib/personalRecordAchievements";
import { queryClient } from "@/lib/queryClient";
import { mapTimelineCache, type TimelineCache } from "@/lib/timelineCache";
import {
  EXERCISE_HISTORY_QUERY_PREFIX,
  WORKOUT_DERIVED_NUTRITION_QUERY_KEYS,
} from "@/lib/workoutInvalidation";

import { useApiMutation } from "../useApiMutation";
import { useUndoDeleteToast } from "../useRecycleBin";
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
  queryClient.setQueriesData<TimelineCache>({ queryKey: QUERY_KEYS.timeline }, (old) =>
    mapTimelineCache(old, (entries) => {
      let patched = false;
      const nextEntries = entries.map((entry) => {
        if (entry.planDayId !== variables.planDayId) return entry;
        patched = true;
        return buildLoggedTimelineEntry(workout, entry);
      });
      return patched ? nextEntries : entries;
    }),
  );
}

// A queued log has no workout yet. The pending-workout overlay already shows
// it from the queue (usePendingWorkoutEntries), so the planned row it
// completes comes off the cached timeline rather than staying beside it,
// flipped to completed with no log behind it and the circle hidden. In-session
// only, like a queued status change: the post-sync refetch brings the day
// back, completed and linked. CL55 (CODEBASE_ANALYSIS_2026-10-03)
function removePlannedEntryForQueuedLog(planDayId: string): void {
  queryClient.setQueriesData<TimelineCache>({ queryKey: QUERY_KEYS.timeline }, (old) =>
    mapTimelineCache(old, (entries) => {
      const kept = entries.filter((entry) => entry.planDayId !== planDayId || Boolean(entry.workoutLogId));
      return kept.length === entries.length ? entries : kept;
    }),
  );
}

function createWorkoutOptions(idempotencyKey: string | undefined): { idempotencyKey: string } | undefined {
  return idempotencyKey ? { idempotencyKey } : undefined;
}

export function useWorkoutActionMutations(selectedPlanId: string | null) {
  const { toast } = useToast();
  // Every delete below lands in the recycle bin; the success toast carries an
  // Undo that restores it (one item, or the whole bulk-delete batch).
  const showUndoDelete = useUndoDeleteToast();
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
    mutationFn: ({ dayId, status, skipReason }: UpdateStatusVariables) => {
      // The reason has to live in `body`, not just in the `perform` closure:
      // offlineMutationFallback enqueues `body` verbatim for replay, so a skip
      // made offline would otherwise sync with the reason silently dropped.
      const body = skipReason === undefined ? { status } : { status, skipReason };
      return runWithOfflineFallback({
        method: "PATCH",
        url: `/api/v1/plans/days/${dayId}/status`,
        body,
        perform: (idempotencyKey) =>
          api.plans.updateDayStatus(dayId, body, idempotencyKey ? { idempotencyKey } : undefined),
      });
    },
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
        // A day with no log takes its meal targets from its still-planned
        // session, so a skip changes them, and reopening a completed day
        // deletes its log, with the log's load and calories.
        // CL19 (CODEBASE_ANALYSIS_2026-10-03)
        ...WORKOUT_DERIVED_NUTRITION_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
        // Reopening takes the log's sets out of "Last time" too.
        // CL43 (CODEBASE_ANALYSIS_2026-10-03)
        queryClient.invalidateQueries({ queryKey: EXERCISE_HISTORY_QUERY_PREFIX }),
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
    // The same queue-backed fallback /log saves through: a connection that
    // drops mid-request queues the log instead of failing it, under the
    // idempotency key the live attempt sent. CL55 (CODEBASE_ANALYSIS_2026-10-03)
    mutationFn: (data: LogWorkoutVariables) => {
      const { sourceEntry: _sourceEntry, ...payload } = data;
      return runWithOfflineFallback({
        method: "POST",
        url: WORKOUT_CREATE_URL,
        body: payload,
        perform: (idempotencyKey) => api.workouts.create(payload, createWorkoutOptions(idempotencyKey)),
      });
    },
    successToast: (result) =>
      result.status === "queued"
        ? {
          title: "Workout queued",
          description: "We'll sync it automatically when your connection is back.",
        }
        : { title: "Workout logged!" },
    errorToast: "Failed to log workout",
    ...logWorkoutHandlers,
    onSuccess: async (result, variables) => {
      markAutoCoachingActive();
      // Not on the server yet: nothing to prime or refetch. The post-sync
      // invalidation covers it after replay.
      if (result.status === "queued") {
        removePlannedEntryForQueuedLog(variables.planDayId);
        return;
      }
      const { data } = result;
      // Prime the workout-detail cache so the ReviewSurface (mounted via
      // the URL→state effect after the timeline patch flips the entry to
      // completed + workoutLogId) renders seeded sets / RPE / notes
      // immediately on its first paint without waiting for the
      // useWorkoutDetail(workoutId) GET round-trip.
      queryClient.setQueryData(QUERY_KEYS.workout(data.id), data);
      patchTimelineEntriesForLoggedWorkout(data, variables);
      await Promise.all([
        // The POST response is not the detail read: it carries no
        // `structureBlocks` or `suggestedRpe`, and the primed entry counted as
        // fresh for the full staleTime, so the review sheet of an EMOM or
        // interval day showed no blocks to score. Marking it stale makes the
        // sheet fetch the full detail as it mounts, behind the primed first
        // paint (CL24, CODEBASE_ANALYSIS_2026-10-03).
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workout(data.id) }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.personalRecords }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.exerciseAnalytics }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trainingOverview }),
        // The log takes over the day's meal targets from the planned session
        // and adds to its training load. CL19 (CODEBASE_ANALYSIS_2026-10-03)
        ...WORKOUT_DERIVED_NUTRITION_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
        // Its sets are the newest "Last time". CL43 (CODEBASE_ANALYSIS_2026-10-03)
        queryClient.invalidateQueries({ queryKey: EXERCISE_HISTORY_QUERY_PREFIX }),
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
      // The day loses the workout's load, calories and meal-target anchor.
      // CL19 (CODEBASE_ANALYSIS_2026-10-03)
      ...WORKOUT_DERIVED_NUTRITION_QUERY_KEYS,
      // A deleted session no longer drives "Last time". CL43 (CODEBASE_ANALYSIS_2026-10-03)
      EXERCISE_HISTORY_QUERY_PREFIX,
    ],
    errorToast: "Failed to delete workout",
    ...deleteWorkoutHandlers,
    onSuccess: (data) => {
      showUndoDelete({ title: "Workout deleted", target: { itemId: data.recycleBinItemId } });
    },
  });

  const deletePlanDayHandlers = buildOptimisticTimelineHandlers<string>(
    selectedPlanId,
    (old, dayId) => old.filter((entry) => entry.planDayId !== dayId),
  );
  const deletePlanDayMutation = useApiMutation({
    mutationFn: (dayId: string) => api.plans.deleteDay(dayId),
    // A day with no log takes its meal targets from its planned session.
    // CL19 (CODEBASE_ANALYSIS_2026-10-03)
    invalidateQueries: [QUERY_KEYS.timeline, QUERY_KEYS.plans, QUERY_KEYS.nutritionDayPrefix],
    errorToast: "Failed to delete workout",
    ...deletePlanDayHandlers,
    onSuccess: (data) => {
      showUndoDelete({ title: "Workout removed from plan", target: { itemId: data.recycleBinItemId } });
    },
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
      // CL19 and CL43 (CODEBASE_ANALYSIS_2026-10-03), as for a single delete.
      ...WORKOUT_DERIVED_NUTRITION_QUERY_KEYS,
      EXERCISE_HISTORY_QUERY_PREFIX,
    ],
    errorToast: "Failed to delete workouts",
    ...bulkDeleteWorkoutHandlers,
    onSuccess: (data) => {
      showUndoDelete({
        title: data.deletedCount === 1 ? "Workout removed" : `${data.deletedCount} workouts removed`,
        target: { batchId: data.batchId },
      });
    },
  });

  return {
    updateStatusMutation,
    logWorkoutMutation,
    deleteWorkoutMutation,
    deletePlanDayMutation,
    bulkDeleteWorkoutMutation,
  };
}

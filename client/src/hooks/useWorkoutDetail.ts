import type { ExerciseSet, WorkoutLog } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";

import { useApiMutation } from "@/hooks/useApiMutation";
import {
  type AddExerciseSetPayload,
  api,
  type PatchExerciseSetPayload,
  QUERY_KEYS,
  type WorkoutHistoryStats,
} from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

type WorkoutWithSets = WorkoutLog & { exerciseSets?: ExerciseSet[] };

/**
 * Data + mutation bundle used by the v2 workout detail dialog. Keeps the
 * dialog component free of React Query wiring: it consumes
 * `{ workout, history, isLoading, updateSet, addSet, deleteSet,
 * seedFromPlan }` and renders. Set mutations are optimistic — they patch
 * the cached workout in place so the table doesn't flicker on every
 * debounced keystroke — and only fall back to a full invalidation when a
 * server error rolls the optimistic write back.
 */
export function useWorkoutDetail(workoutId: string | null) {
  const workoutQuery = useQuery({
    queryKey: workoutId ? QUERY_KEYS.workout(workoutId) : ["workout-detail-disabled"],
    queryFn: () => api.workouts.get(workoutId!),
    enabled: !!workoutId,
  });

  const historyQuery = useQuery({
    queryKey: workoutId ? QUERY_KEYS.workoutHistory(workoutId) : ["workout-history-disabled"],
    queryFn: () => api.workouts.history(workoutId!),
    enabled: !!workoutId,
  });

  const patchCachedSets = (updater: (sets: ExerciseSet[]) => ExerciseSet[]) => {
    if (!workoutId) return;
    queryClient.setQueryData<WorkoutWithSets>(QUERY_KEYS.workout(workoutId), (prev) => {
      if (!prev) return prev;
      return { ...prev, exerciseSets: updater(prev.exerciseSets ?? []) };
    });
  };

  const updateSet = useApiMutation({
    mutationFn: ({ setId, data }: { setId: string; data: PatchExerciseSetPayload }) =>
      api.workouts.updateSet(workoutId!, setId, data),
    // Optimistic patch: merge the payload into the cached row so the table
    // reflects the edit immediately, then let the server's response
    // reconcile via the onSuccess replace below.
    onMutate: async ({ setId, data }) => {
      if (!workoutId) return undefined;
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.workout(workoutId) });
      const prev = queryClient.getQueryData<WorkoutWithSets>(QUERY_KEYS.workout(workoutId));
      patchCachedSets((sets) => sets.map((s) => (s.id === setId ? { ...s, ...data } as ExerciseSet : s)));
      return { prev };
    },
    onSuccess: (serverSet) => {
      patchCachedSets((sets) => sets.map((s) => (s.id === serverSet.id ? serverSet : s)));
    },
    onError: (_err, _vars, ctx) => {
      const prev = (ctx as { prev?: WorkoutWithSets } | undefined)?.prev;
      if (workoutId && prev) {
        queryClient.setQueryData(QUERY_KEYS.workout(workoutId), prev);
      }
    },
    errorToast: "Couldn't save that change",
  });

  const addSet = useApiMutation({
    mutationFn: (data: AddExerciseSetPayload) => api.workouts.addSet(workoutId!, data),
    onSuccess: (serverSet) => {
      patchCachedSets((sets) => [...sets, serverSet]);
    },
    errorToast: "Couldn't add that exercise",
    invalidateQueries: workoutId ? [QUERY_KEYS.workoutHistory(workoutId)] : undefined,
  });

  const deleteSet = useApiMutation({
    mutationFn: (setId: string) => api.workouts.deleteSet(workoutId!, setId).then(() => setId),
    onMutate: async (setId: string) => {
      if (!workoutId) return undefined;
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.workout(workoutId) });
      const prev = queryClient.getQueryData<WorkoutWithSets>(QUERY_KEYS.workout(workoutId));
      patchCachedSets((sets) => sets.filter((s) => s.id !== setId));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      const prev = (ctx as { prev?: WorkoutWithSets } | undefined)?.prev;
      if (workoutId && prev) {
        queryClient.setQueryData(QUERY_KEYS.workout(workoutId), prev);
      }
    },
    errorToast: "Couldn't remove that set",
    invalidateQueries: workoutId ? [QUERY_KEYS.workoutHistory(workoutId)] : undefined,
  });

  const seedFromPlan = useApiMutation({
    mutationFn: () => api.workouts.seedFromPlan(workoutId!),
    // Seed is idempotent on the server, so we can let React Query refetch
    // the workout once it succeeds rather than reconciling inline.
    invalidateQueries: workoutId
      ? [QUERY_KEYS.workout(workoutId), QUERY_KEYS.workoutHistory(workoutId)]
      : undefined,
  });

  return {
    workout: workoutQuery.data as WorkoutWithSets | undefined,
    history: historyQuery.data as WorkoutHistoryStats | undefined,
    isLoading: workoutQuery.isLoading,
    isError: workoutQuery.isError,
    updateSet,
    addSet,
    deleteSet,
    seedFromPlan,
  };
}

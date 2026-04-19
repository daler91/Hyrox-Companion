import type { ExerciseSet, WorkoutLog } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";

import { useApiMutation } from "@/hooks/useApiMutation";
import {
  type AddExerciseSetPayload,
  api,
  type PatchExerciseSetPayload,
  QUERY_KEYS,
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

  const patchCachedWorkout = (patch: Partial<WorkoutWithSets>) => {
    if (!workoutId) return;
    queryClient.setQueryData<WorkoutWithSets>(QUERY_KEYS.workout(workoutId), (prev) =>
      prev ? { ...prev, ...patch } : prev,
    );
  };

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

  // Lazy parse for legacy free-text workouts: if seed-from-plan returned
  // nothing (or there's no plan day linked) but the workout has free
  // text in mainWorkout/accessory, call /reparse to hydrate the table
  // via the existing Gemini parse pipeline. Fires at most once per
  // workoutId, coordinated from WorkoutDetailDialogV2's hydration
  // useEffect. Errors surface through the `useApiMutation` toast layer.
  const reparseFreeText = useApiMutation({
    mutationFn: () => api.workouts.reparse(workoutId!),
    invalidateQueries: workoutId
      ? [QUERY_KEYS.workout(workoutId), QUERY_KEYS.workoutHistory(workoutId)]
      : undefined,
    // No error toast — reparse failure is a best-effort fallback, not a
    // user-initiated action. Empty state + coach's prescription remain
    // visible, which is the graceful degradation path.
  });

  const isHydrating = seedFromPlan.isPending || reparseFreeText.isPending;

  // Debounced note autosave lives here (and NOT on the global
  // updateWorkoutMutation in useWorkoutActions) so saving doesn't trigger
  // that mutation's onSuccess → setDetailEntry(null) side-effect, which
  // would dismiss the dialog after the first keystroke lands.
  const updateNote = useApiMutation({
    mutationFn: (notes: string | null) => api.workouts.update(workoutId!, { notes }),
    onMutate: async (notes) => {
      if (!workoutId) return undefined;
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.workout(workoutId) });
      const prev = queryClient.getQueryData<WorkoutWithSets>(QUERY_KEYS.workout(workoutId));
      patchCachedWorkout({ notes });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      const prev = (ctx as { prev?: WorkoutWithSets } | undefined)?.prev;
      if (workoutId && prev) {
        queryClient.setQueryData(QUERY_KEYS.workout(workoutId), prev);
      }
    },
    errorToast: "Couldn't save that note",
  });

  // Inline RPE edit from the stats row. Non-optimistic on purpose —
  // rollback snapshots from concurrent edits can stomp newer
  // successful values. We also avoid invalidating the whole workout
  // query on success: that would refetch and clobber other in-flight
  // optimistic edits in the same cache entry (e.g. a pending note
  // save has already patched cache.notes via its own onMutate but
  // hasn't reached the server yet — an RPE refetch would restore the
  // stale server-side notes).
  //
  // Each mutate() bumps rpeSeqRef and stashes the value as context;
  // onSuccess ignores any response whose seq isn't the latest, so an
  // older request resolving after a newer one can't overwrite the
  // newer cache value. workoutHistory + timeline are invalidated so
  // the sidebar's Block avg RPE and the timeline card's RPE number
  // refresh.
  const rpeSeqRef = useRef(0);
  const updateRpe = useApiMutation({
    mutationFn: (rpe: number | null) => api.workouts.update(workoutId!, { rpe }),
    onMutate: () => {
      rpeSeqRef.current += 1;
      return { seq: rpeSeqRef.current };
    },
    onSuccess: (serverWorkout, _rpe, ctx) => {
      const seq = (ctx as { seq?: number } | undefined)?.seq;
      if (seq !== rpeSeqRef.current) return;
      patchCachedWorkout({ rpe: serverWorkout.rpe });
    },
    invalidateQueries: workoutId
      ? [QUERY_KEYS.workoutHistory(workoutId), QUERY_KEYS.timeline]
      : undefined,
    errorToast: "Couldn't save that RPE",
  });

  return {
    workout: workoutQuery.data,
    history: historyQuery.data,
    isLoading: workoutQuery.isLoading,
    isError: workoutQuery.isError,
    isHydrating,
    updateSet,
    addSet,
    deleteSet,
    seedFromPlan,
    reparseFreeText,
    updateNote,
    updateRpe,
  };
}

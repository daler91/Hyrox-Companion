import type { ExerciseSet, WorkoutLog } from "@shared/schema";
import { useIsMutating,useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useApiMutation } from "@/hooks/useApiMutation";
import { useDebouncedSetPatches } from "@/hooks/useDebouncedSetPatches";
import {
  type AddExerciseSetPayload,
  api,
  type PatchExerciseSetPayload,
  QUERY_KEYS,
} from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

type WorkoutWithSets = WorkoutLog & { exerciseSets?: ExerciseSet[] };

// Tag every logged-workout set mutation so useIsMutating can count all
// in-flight writes for the current workout — useMutation.isPending only
// reflects the latest mutate() call, which would hide concurrent PATCHes
// when a row edit fans out to multiple set ids. Mirrors the family-key
// pattern in usePlanDayExercises.
const workoutSetsMutationKey = (workoutId: string) =>
  ["workout-sets", workoutId] as const;

// Debounce window the cell inputs used to own. Lifted here for the same
// reason as usePlanDayExercises — the Save button needs a flush seam the
// per-component debounce couldn't provide.
const CELL_SAVE_DEBOUNCE_MS = 350;

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

  // See usePlanDayExercises.ts for the rationale — tracked here so the
  // logged-workout variant of the ExerciseTable can show the same
  // "Saving… / Saved" feedback the planned variant gets. `ownerId` is a
  // render-time sentinel that resets the Saved timestamp when the hook's
  // workoutId changes, so the flash from a previous entry doesn't bleed
  // into the next dialog open. Using this pattern instead of a
  // setState-in-effect satisfies react-hooks/set-state-in-effect.
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [ownerId, setOwnerId] = useState(workoutId);
  if (workoutId !== ownerId) {
    setOwnerId(workoutId);
    setLastSavedAt(null);
  }
  const markSaved = () => setLastSavedAt(Date.now());

  const updateSet = useApiMutation({
    mutationKey: workoutId ? workoutSetsMutationKey(workoutId) : undefined,
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
      markSaved();
    },
    onError: (_err, _vars, ctx) => {
      const prev = (ctx as { prev?: WorkoutWithSets } | undefined)?.prev;
      if (workoutId && prev) {
        queryClient.setQueryData(QUERY_KEYS.workout(workoutId), prev);
      }
    },
    errorToast: "Couldn't save that change",
  });

  // Per-set debounce coordinator. Cells call `patchSetDebounced`; the
  // Save button flushes pending patches synchronously via
  // `flushPendingSetPatches` before any downstream drain-waiters settle.
  const { patchSetDebounced, flushPendingSetPatches } = useDebouncedSetPatches<PatchExerciseSetPayload>(
    updateSet.mutate,
    CELL_SAVE_DEBOUNCE_MS,
  );

  const addSet = useApiMutation({
    mutationKey: workoutId ? workoutSetsMutationKey(workoutId) : undefined,
    mutationFn: (data: AddExerciseSetPayload) => api.workouts.addSet(workoutId!, data),
    onSuccess: (serverSet) => {
      patchCachedSets((sets) => [...sets, serverSet]);
      markSaved();
    },
    errorToast: "Couldn't add that exercise",
    invalidateQueries: workoutId ? [QUERY_KEYS.workoutHistory(workoutId)] : undefined,
  });

  const deleteSet = useApiMutation({
    mutationKey: workoutId ? workoutSetsMutationKey(workoutId) : undefined,
    mutationFn: (setId: string) => api.workouts.deleteSet(workoutId!, setId).then(() => setId),
    onMutate: async (setId: string) => {
      if (!workoutId) return undefined;
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.workout(workoutId) });
      const prev = queryClient.getQueryData<WorkoutWithSets>(QUERY_KEYS.workout(workoutId));
      patchCachedSets((sets) => sets.filter((s) => s.id !== setId));
      return { prev };
    },
    onSuccess: () => {
      markSaved();
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

  const pendingSetMutations = useIsMutating({
    mutationKey: workoutId ? workoutSetsMutationKey(workoutId) : ["workout-sets-disabled"],
    exact: true,
  });
  const isSaving = pendingSetMutations > 0;

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

  // Debounced PATCH for the workout's focus (displayed title). Tagged with
  // workoutSetsMutationKey so the ExerciseTable's save pill reflects title
  // edits too — one unified "Saving…/Saved" signal across the whole dialog.
  // Optimistic: patches the cached workout so the heading updates without a
  // round-trip; rollback restores ONLY the focus field on error. We
  // deliberately don't snapshot the whole workout here — if a set-level
  // mutation succeeded concurrently, restoring the full prior snapshot
  // would clobber those newer successful changes. Timeline is invalidated
  // in onSuccess so card copy reflects the new title within a refetch (we
  // don't have selectedPlanId here, so optimistic timeline patching would
  // have to traverse every cached variant — invalidate is simpler and the
  // staleness window is ~100ms).
  const updateFocus = useApiMutation({
    mutationKey: workoutId ? workoutSetsMutationKey(workoutId) : undefined,
    mutationFn: (focus: string) => api.workouts.update(workoutId!, { focus }),
    onMutate: async (focus) => {
      if (!workoutId) return undefined;
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.workout(workoutId) });
      const prevFocus = queryClient.getQueryData<WorkoutWithSets>(
        QUERY_KEYS.workout(workoutId),
      )?.focus;
      patchCachedWorkout({ focus });
      return { prevFocus };
    },
    onSuccess: async () => {
      markSaved();
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline });
    },
    onError: (_err, _vars, ctx) => {
      const prevFocus = (ctx as { prevFocus?: string } | undefined)?.prevFocus;
      if (workoutId && prevFocus !== undefined) {
        queryClient.setQueryData<WorkoutWithSets>(QUERY_KEYS.workout(workoutId), (curr) =>
          curr ? { ...curr, focus: prevFocus } : curr,
        );
      }
    },
    errorToast: "Couldn't save title",
  });

  // Generic PATCH for the free-text fields on a workout log. `mainWorkout`
  // is non-null on the schema (an empty string means "no prescription"),
  // while accessory/notes are nullable. We normalise the caller's patch so
  // mainWorkout-null collapses to "" before hitting the API.
  const updatePrescription = useApiMutation({
    mutationFn: (patch: { mainWorkout?: string | null; accessory?: string | null; notes?: string | null }) => {
      const normalized: { mainWorkout?: string; accessory?: string | null; notes?: string | null } = {};
      if (patch.mainWorkout !== undefined) normalized.mainWorkout = patch.mainWorkout ?? "";
      if (patch.accessory !== undefined) normalized.accessory = patch.accessory;
      if (patch.notes !== undefined) normalized.notes = patch.notes;
      return api.workouts.update(workoutId!, normalized);
    },
    onMutate: async (patch) => {
      if (!workoutId) return undefined;
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.workout(workoutId) });
      const prev = queryClient.getQueryData<WorkoutWithSets>(QUERY_KEYS.workout(workoutId));
      const optimistic: Partial<WorkoutWithSets> = {};
      if (patch.mainWorkout !== undefined) optimistic.mainWorkout = patch.mainWorkout ?? "";
      if (patch.accessory !== undefined) optimistic.accessory = patch.accessory;
      if (patch.notes !== undefined) optimistic.notes = patch.notes;
      patchCachedWorkout(optimistic);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      const prev = (ctx as { prev?: WorkoutWithSets } | undefined)?.prev;
      if (workoutId && prev) {
        queryClient.setQueryData(QUERY_KEYS.workout(workoutId), prev);
      }
    },
    errorToast: "Couldn't save prescription",
  });

  // Inline RPE edit from the stats row. Non-optimistic — rollback
  // snapshots from concurrent edits can stomp newer successful
  // values, and invalidating the whole workout query on success
  // would clobber other in-flight optimistic edits in the same cache
  // entry (notes in particular).
  //
  // Callers pass `forWorkoutId` as part of the mutation variable so
  // cache writes land on the workout that originated the save, even
  // if the dialog has re-rendered for a different entry by the time
  // the server responds.
  //
  // `rpeSeqPerWorkoutRef` tracks the latest submitted sequence per
  // workout id. onMutate bumps a monotonic counter and stashes the
  // seq in the mutation context; onSuccess only patches if the
  // context seq is still the latest for that workout. A sequence is
  // stricter than value equality — `8 → 9 → 8` races can't alias.
  //
  // Tradeoff: if a newer save fails and an older one succeeds after
  // it, the older success is discarded and cache lags until reopen.
  // We accept that over invalidating the workout and clobbering
  // in-flight note edits.
  const rpeSeqPerWorkoutRef = useRef(new Map<string, number>());
  const rpeSeqCounterRef = useRef(0);
  const updateRpe = useApiMutation<
    WorkoutLog,
    Error,
    { rpe: number | null; forWorkoutId: string },
    { seq: number }
  >({
    mutationFn: ({ rpe, forWorkoutId }) => api.workouts.update(forWorkoutId, { rpe }),
    onMutate: ({ forWorkoutId }) => {
      rpeSeqCounterRef.current += 1;
      const seq = rpeSeqCounterRef.current;
      rpeSeqPerWorkoutRef.current.set(forWorkoutId, seq);
      return { seq };
    },
    onSuccess: async (serverWorkout, { forWorkoutId }, ctx) => {
      if (ctx.seq !== rpeSeqPerWorkoutRef.current.get(forWorkoutId)) return;
      queryClient.setQueryData<WorkoutWithSets>(QUERY_KEYS.workout(forWorkoutId), (p) =>
        p ? { ...p, rpe: serverWorkout.rpe } : p,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workoutHistory(forWorkoutId) }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }),
      ]);
    },
    errorToast: "Couldn't save that RPE",
  });

  return {
    workout: workoutQuery.data,
    history: historyQuery.data,
    isLoading: workoutQuery.isLoading,
    isError: workoutQuery.isError,
    isHydrating,
    isSaving,
    lastSavedAt,
    updateSet,
    patchSetDebounced,
    flushPendingSetPatches,
    addSet,
    deleteSet,
    seedFromPlan,
    reparseFreeText,
    updateNote,
    updatePrescription,
    updateFocus,
    updateRpe,
  };
}

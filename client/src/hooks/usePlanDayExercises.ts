import type { ExerciseSet } from "@shared/schema";
import { useIsMutating,useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useApiMutation } from "@/hooks/useApiMutation";
import { type AddExerciseSetPayload, api, type PatchExerciseSetPayload, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

// Tag every plan-day set mutation with this key family so useIsMutating
// can count ALL in-flight writes for the current plan day — not just
// the most recent one. useMutation.isPending only reflects the latest
// mutate() call, which would hide concurrent PATCHes when a row edit
// fans out to multiple set ids.
const planDaySetsMutationKey = (planDayId: string) => ["plan-day-sets", planDayId] as const;

// Same debounce window the cell inputs used to own. Lifted here because
// the Save button needs to flush pending cell edits synchronously before
// regenerating the coach note; a per-component debounce has no flush seam.
const CELL_SAVE_DEBOUNCE_MS = 350;

interface PendingSetPatch {
  timer: ReturnType<typeof setTimeout>;
  patch: PatchExerciseSetPayload;
}

/**
 * Mutation + query bundle for a plan day's prescribed exercise sets.
 * Used by the v2 workout detail dialog when a planned entry is open so
 * the athlete can tweak the coach's prescription before marking
 * complete. Mirrors useWorkoutDetail's updateSet / addSet / deleteSet
 * shape so the ExerciseTable component can plug in either source
 * without knowing which owner it's writing to.
 *
 * When Mark complete fires, phase-6's createWorkoutInTx copies
 * whatever rows this hook has persisted into the new workoutLog — so
 * these edits are the starting state of the logged workout.
 */
export function usePlanDayExercises(planDayId: string | null) {
  const queryKey = planDayId
    ? QUERY_KEYS.planDayExercises(planDayId)
    : ["plan-day-exercises-disabled"];
  const exercisesQuery = useQuery({
    queryKey,
    queryFn: () => api.plans.getDayExercises(planDayId!),
    enabled: !!planDayId,
  });

  const patchCachedSets = (updater: (sets: ExerciseSet[]) => ExerciseSet[]) => {
    if (!planDayId) return;
    queryClient.setQueryData<ExerciseSet[]>(QUERY_KEYS.planDayExercises(planDayId), (prev) => {
      return updater(prev ?? []);
    });
  };

  // Epoch-ms timestamp of the most recent successful set mutation. The
  // ExerciseTable's SaveStatePill uses this to show a fading "Saved" badge
  // after each debounced PATCH lands, so the athlete has visible proof the
  // edit persisted — otherwise the only feedback today is an optimistic
  // cache update that looks identical whether the server saw the change or
  // not. `ownerId` is a render-time sentinel that resets the timestamp
  // when the owning plan day changes, so signals from a prior entry (used
  // by CoachTakePanel staleness + auto-regenerate-on-close) don't bleed
  // into the next one. Using this pattern instead of a setState-in-effect
  // satisfies react-hooks/set-state-in-effect.
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [ownerId, setOwnerId] = useState(planDayId);
  if (planDayId !== ownerId) {
    setOwnerId(planDayId);
    setLastSavedAt(null);
  }
  const markSaved = () => setLastSavedAt(Date.now());

  const updateSet = useApiMutation({
    mutationKey: planDayId ? planDaySetsMutationKey(planDayId) : undefined,
    mutationFn: ({ setId, data }: { setId: string; data: PatchExerciseSetPayload }) =>
      api.plans.updateDayExercise(planDayId!, setId, data),
    onMutate: async ({ setId, data }) => {
      if (!planDayId) return undefined;
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.planDayExercises(planDayId) });
      const prev = queryClient.getQueryData<ExerciseSet[]>(QUERY_KEYS.planDayExercises(planDayId));
      patchCachedSets((sets) => sets.map((s) => (s.id === setId ? { ...s, ...data } as ExerciseSet : s)));
      return { prev };
    },
    onSuccess: (serverSet) => {
      patchCachedSets((sets) => sets.map((s) => (s.id === serverSet.id ? serverSet : s)));
      markSaved();
    },
    onError: (_err, _vars, ctx) => {
      const prev = (ctx as { prev?: ExerciseSet[] } | undefined)?.prev;
      if (planDayId && prev) {
        queryClient.setQueryData(QUERY_KEYS.planDayExercises(planDayId), prev);
      }
    },
    errorToast: "Couldn't save that change",
  });

  // Per-set debounce coordinator. Cell inputs hand raw patches to
  // `patchSetDebounced`; each set id owns one pending entry whose patch
  // fields merge as the user edits within the window. The Save button
  // calls `flushPendingSetPatches` to commit everything synchronously
  // before the regenerate fires — otherwise the server snapshots a
  // pre-edit plan day. `firePatchRef` is re-assigned each render so the
  // timer/flush callbacks always see the freshest `updateSet.mutate`.
  const pendingPatchesRef = useRef<Map<string, PendingSetPatch>>(new Map());
  const firePatchRef = useRef<(setId: string) => void>(() => {});
  firePatchRef.current = (setId: string) => {
    const entry = pendingPatchesRef.current.get(setId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pendingPatchesRef.current.delete(setId);
    updateSet.mutate({ setId, data: entry.patch });
  };

  const patchSetDebounced = (setId: string, patch: PatchExerciseSetPayload) => {
    const existing = pendingPatchesRef.current.get(setId);
    if (existing) clearTimeout(existing.timer);
    const merged = { ...(existing?.patch ?? {}), ...patch };
    const timer = setTimeout(
      () => firePatchRef.current(setId),
      CELL_SAVE_DEBOUNCE_MS,
    );
    pendingPatchesRef.current.set(setId, { timer, patch: merged });
  };

  const flushPendingSetPatches = () => {
    const ids = Array.from(pendingPatchesRef.current.keys());
    for (const setId of ids) firePatchRef.current(setId);
  };

  // Flush on unmount so closing the dialog mid-edit doesn't silently drop
  // the last keystroke — matches the guarantee useDebouncedCallback gave
  // when the debounce lived inside each cell input.
  useEffect(() => {
    const pending = pendingPatchesRef.current;
    const fire = firePatchRef;
    return () => {
      const ids = Array.from(pending.keys());
      for (const setId of ids) fire.current(setId);
    };
  }, []);

  const addSet = useApiMutation({
    mutationKey: planDayId ? planDaySetsMutationKey(planDayId) : undefined,
    mutationFn: (data: AddExerciseSetPayload) => api.plans.addDayExercise(planDayId!, data),
    onSuccess: (serverSet) => {
      patchCachedSets((sets) => [...sets, serverSet]);
      markSaved();
    },
    errorToast: "Couldn't add that exercise",
  });

  const deleteSet = useApiMutation({
    mutationKey: planDayId ? planDaySetsMutationKey(planDayId) : undefined,
    mutationFn: (setId: string) =>
      api.plans.deleteDayExercise(planDayId!, setId).then(() => setId),
    onMutate: async (setId: string) => {
      if (!planDayId) return undefined;
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.planDayExercises(planDayId) });
      const prev = queryClient.getQueryData<ExerciseSet[]>(QUERY_KEYS.planDayExercises(planDayId));
      patchCachedSets((sets) => sets.filter((s) => s.id !== setId));
      return { prev };
    },
    onSuccess: () => {
      markSaved();
    },
    onError: (_err, _vars, ctx) => {
      const prev = (ctx as { prev?: ExerciseSet[] } | undefined)?.prev;
      if (planDayId && prev) {
        queryClient.setQueryData(QUERY_KEYS.planDayExercises(planDayId), prev);
      }
    },
    errorToast: "Couldn't remove that set",
  });

  // Plan-day Parse: POST /reparse → Gemini parses mainWorkout/accessory into
  // structured rows, replacing this day's prescription. React Query's server
  // state is refreshed via an explicit query invalidation rather than
  // reconciling in-hand because the response shape (`exercises[]`) is the
  // parsed-exercise DTO, not ExerciseSet rows.
  const reparseFreeText = useApiMutation({
    mutationFn: () => api.plans.reparseDay(planDayId!),
    invalidateQueries: planDayId ? [QUERY_KEYS.planDayExercises(planDayId)] : undefined,
    errorToast: "Parse failed — try rewording and retry.",
  });

  // Debounced PATCH of free-text fields (focus / mainWorkout / accessory /
  // notes) on the plan day. Intentionally not optimistic-cached — the
  // timeline query owns these fields and we rely on invalidation to refresh
  // `entry.*` in the dialog. A silent error toast would hide data loss, so
  // we keep the explicit toast.
  //
  // Tagged with planDaySetsMutationKey so the ExerciseTable's save pill (and
  // the dialog header's pill) reflect in-flight title/prescription edits —
  // otherwise the user would only see feedback for per-set cell writes.
  const updatePrescription = useApiMutation({
    mutationKey: planDayId ? planDaySetsMutationKey(planDayId) : undefined,
    mutationFn: (patch: { focus?: string; mainWorkout?: string | null; accessory?: string | null; notes?: string | null }) =>
      api.plans.updateDayWithoutPlan(planDayId!, patch),
    invalidateQueries: [QUERY_KEYS.timeline, QUERY_KEYS.plans],
    onSuccess: () => {
      markSaved();
    },
    errorToast: "Couldn't save prescription",
  });

  // Count every in-flight mutation tagged with this plan day's key,
  // not just the most recent mutate() call on a single observer.
  // Row-level edits fan out to one PATCH per set in the group, so
  // `updateSet.isPending` alone would read false as soon as the last
  // call settled — even if earlier calls were still pending — and
  // Mark complete could fire with partially stale rows on the server.
  const pendingMutationCount = useIsMutating({
    mutationKey: planDayId ? planDaySetsMutationKey(planDayId) : ["plan-day-sets-disabled"],
    // Scope to exact match of this plan day; other plan days' edits
    // shouldn't block this dialog.
    exact: true,
  });
  const isSaving = pendingMutationCount > 0;

  return {
    exerciseSets: exercisesQuery.data ?? [],
    isLoading: exercisesQuery.isLoading,
    isSaving,
    lastSavedAt,
    updateSet,
    patchSetDebounced,
    flushPendingSetPatches,
    addSet,
    deleteSet,
    reparseFreeText,
    updatePrescription,
  };
}

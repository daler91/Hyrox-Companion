import type { ExerciseSet } from "@shared/schema";
import { restampSetPatch } from "@shared/unitConversion";
import { useIsMutating } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useApiMutation } from "@/hooks/useApiMutation";
import { useDebouncedSetPatches } from "@/hooks/useDebouncedSetPatches";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { type AddExerciseSetPayload, type PatchExerciseSetPayload } from "@/lib/api/exerciseSetMutations";
import { createSetVersionTracker, isSetConflictError } from "@/lib/exerciseSetVersionLock";
import { humanizeApiError, queryClient } from "@/lib/queryClient";

type QueryKey = readonly unknown[];

type Params<TSnapshot> = {
  ownerId: string | null;
  mutationKeyFamily: (ownerId: string) => QueryKey;
  setsQueryKey: (ownerId: string) => QueryKey;
  /**
   * Takes the owner explicitly, like getSnapshot/restoreSnapshot: a debounced
   * edit can land after the hook has moved to another owner (CL18).
   */
  patchCachedSets: (ownerId: string, updater: (sets: ExerciseSet[]) => ExerciseSet[]) => void;
  getSnapshot: (ownerId: string) => TSnapshot | undefined;
  restoreSnapshot: (ownerId: string, snapshot: TSnapshot) => void;
  updateSetRequest: (ownerId: string, setId: string, data: PatchExerciseSetPayload) => Promise<ExerciseSet>;
  addSetRequest: (ownerId: string, data: AddExerciseSetPayload) => Promise<ExerciseSet>;
  deleteSetRequest: (ownerId: string, setId: string) => Promise<unknown>;
  addInvalidateQueries?: (ownerId: string) => QueryKey[] | undefined;
  deleteInvalidateQueries?: (ownerId: string) => QueryKey[] | undefined;
  /**
   * Invoked after ANY successful set write — update, add or delete. Logged
   * workouts pass `scheduleWorkoutWriteInvalidation` (lib/workoutInvalidation):
   * editing a set moves personal records, exercise analytics and the training
   * overview exactly as much as logging the workout did, yet only the
   * workout's own cache entry was ever invalidated, so those screens kept
   * serving pre-edit numbers. The scheduled form coalesces a burst of cell
   * saves into one trailing refetch (audit P1) — passing the immediate
   * `invalidateWorkoutWriteQueries` here would bring back the per-keystroke
   * refetch storm. Planned days leave it unset — planned sets don't feed any
   * of those derived views.
   */
  onWriteSuccess?: () => void;
  cellSaveDebounceMs?: number;
};

type UpdateSetVariables = {
  readonly setId: string;
  readonly data: PatchExerciseSetPayload;
  /**
   * The owner the edit was made under; the current one when omitted. The
   * debounce coordinator always sets it, so an edit flushed after the owner
   * changed (a closed sheet, a switched workout) still PATCHes its own owner
   * (CL18, CODEBASE_ANALYSIS_2026-10-03).
   */
  readonly ownerId?: string;
};
type UpdateSetContext<TSnapshot> = {
  readonly ownerId: string;
  readonly prev: TSnapshot | undefined;
  readonly seq: number;
  readonly setId: string;
};

const SAVE_FAILED_TITLE = "Couldn't save that change";
// D5: the edit was made against a row another device has since changed. The
// optimistic value is rolled back and the owner's sets refetched, so the toast
// says what the athlete will see next rather than offering a retry.
const CONFLICT_TOAST = {
  title: "This set was updated elsewhere",
  description: "Showing the latest values.",
};

/**
 * The units a patch's weight/distance numbers were composed in — the
 * preferences the table displayed them under — for each axis the patch touches.
 *
 * The server used to stamp every write with the preference IT held, so after a
 * unit switch on another device this tab's kg entry was stored as lbs (D22,
 * CODEBASE_ANALYSIS_2026-10-03). An axis the patch leaves alone names no unit,
 * so the server does not re-stamp it.
 */
function composedUnitsFor(
  data: PatchExerciseSetPayload,
  units: Pick<ReturnType<typeof useUnitPreferences>, "weightUnit" | "distanceUnit">,
): Pick<PatchExerciseSetPayload, "weightUnit" | "distanceUnit"> {
  const touchesWeight = data.weight !== undefined || data.plannedWeight !== undefined;
  const touchesDistance = data.distance !== undefined || data.plannedDistance !== undefined;
  return {
    ...(touchesWeight ? { weightUnit: units.weightUnit } : {}),
    ...(touchesDistance ? { distanceUnit: units.distanceUnit } : {}),
  };
}

export function useExerciseSetsForOwner<TSnapshot>({
  ownerId,
  mutationKeyFamily,
  setsQueryKey,
  patchCachedSets,
  getSnapshot,
  restoreSnapshot,
  updateSetRequest,
  addSetRequest,
  deleteSetRequest,
  addInvalidateQueries,
  deleteInvalidateQueries,
  onWriteSuccess,
  cellSaveDebounceMs = 350,
}: Params<TSnapshot>) {
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [lastSaveErrorAt, setLastSaveErrorAt] = useState<number | null>(null);
  const [activeOwnerId, setActiveOwnerId] = useState(ownerId);
  const markSaved = () => setLastSavedAt(Date.now());
  // Records the most recent failed set write so the save pill can show an
  // honest "Couldn't save" state. A later markSaved() supersedes it — the pill
  // compares timestamps — so no explicit clear is needed on a subsequent save.
  const markError = () => setLastSaveErrorAt(Date.now());

  // Per-set sequence guard (W13): each set PATCH bumps its set's counter on
  // mutate; onSuccess only writes the server row back if its PATCH is still the
  // latest in-flight one for that set, so a slower earlier PATCH landing last
  // can't revert a newer edit's optimistic value.
  const setPatchSeqRef = useRef<Map<string, number>>(new Map());

  const unitPreferences = useUnitPreferences();
  // D5: the client half of the exercise_sets optimistic lock. One PATCH per set
  // in flight at a time, each carrying the version the last response reported.
  const [versionTracker] = useState(createSetVersionTracker);

  const sendLockedPatch = async (
    targetOwnerId: string,
    setId: string,
    data: PatchExerciseSetPayload,
  ): Promise<ExerciseSet> => {
    const expectedVersion = versionTracker.expectedVersion(setId);
    const composed = { ...data, ...composedUnitsFor(data, unitPreferences) };
    const body = expectedVersion === undefined ? composed : { ...composed, expectedVersion };
    try {
      const row = await updateSetRequest(targetOwnerId, setId, body);
      // Noted here, not in onSuccess: a response the W13 guard drops for the UI
      // still carries the version the next PATCH on this set must send.
      versionTracker.noteServerVersion(setId, row.version);
      return row;
    } catch (error) {
      // Marked before the per-set queue moves on, so an edit queued behind this
      // one is dropped rather than sent over the other device's write.
      if (isSetConflictError(error)) versionTracker.markConflict(setId);
      throw error;
    }
  };

  const applyOptimisticPatch = (targetOwnerId: string, setId: string, data: PatchExerciseSetPayload) => {
    patchCachedSets(targetOwnerId, (sets) => {
      const row = sets.find((s) => s.id === setId);
      if (!row) return sets;
      versionTracker.seed(setId, row.version);
      // The patch is in the athlete's current unit while the row may be stamped
      // in another. Re-stamping the touched axis (audit L4) keeps the display
      // conversion (D2) from showing a wrong number until the server row lands.
      const next = { ...row, ...restampSetPatch(row, data, unitPreferences) };
      return sets.map((s) => (s === row ? next : s));
    });
  };

  const updateSet = useApiMutation<
    ExerciseSet,
    Error,
    UpdateSetVariables,
    UpdateSetContext<TSnapshot> | undefined
  >({
    mutationKey: ownerId ? mutationKeyFamily(ownerId) : undefined,
    mutationFn: ({ setId, data, ownerId: target = ownerId! }) =>
      versionTracker.enqueue(setId, () => sendLockedPatch(target, setId, data)),
    onMutate: async ({ setId, data, ownerId: target = ownerId ?? undefined }) => {
      if (!target) return undefined;
      const seq = (setPatchSeqRef.current.get(setId) ?? 0) + 1;
      setPatchSeqRef.current.set(setId, seq);
      await queryClient.cancelQueries({ queryKey: setsQueryKey(target) });
      const prev = getSnapshot(target);
      applyOptimisticPatch(target, setId, data);
      return { ownerId: target, prev, seq, setId };
    },
    onSuccess: (serverSet, _vars, ctx) => {
      // Ignore a stale response: if a newer PATCH for this set has since been
      // issued, its optimistic value is the source of truth; don't overwrite
      // it with this older server row (W13).
      const isLatestPatch = ctx !== undefined && ctx.seq === setPatchSeqRef.current.get(ctx.setId);
      if (isLatestPatch) {
        patchCachedSets(ctx.ownerId, (sets) => sets.map((s) => (s.id === serverSet.id ? serverSet : s)));
      }
      markSaved();
      // The write landed even if a newer PATCH superseded its response, so the
      // derived views are out of date either way.
      onWriteSuccess?.();
    },
    onError: (error, vars, ctx) => {
      markError();
      const target = ctx?.ownerId ?? vars.ownerId ?? ownerId;
      if (!target) return;
      if (ctx?.prev) restoreSnapshot(target, ctx.prev);
      // D5: never retry over the other device's write. Refetch so its row shows.
      if (isSetConflictError(error)) {
        void queryClient.invalidateQueries({ queryKey: setsQueryKey(target) });
      }
    },
    errorToast: (error) =>
      isSetConflictError(error)
        ? CONFLICT_TOAST
        : { title: SAVE_FAILED_TITLE, description: humanizeApiError(error) },
  });

  // Each queued edit carries the owner it was made under, and the coordinator
  // flushes the queue when the owner changes rather than this hook cancelling
  // it (CL18). The version tracker is kept across owners for the same reason:
  // set ids are unique across owners, and the flushed PATCH still needs its
  // set's version and must still wait behind that set's in-flight PATCH.
  const { patchSetDebounced, flushPendingSetPatches, getPendingPatches } =
    useDebouncedSetPatches<PatchExerciseSetPayload>(updateSet.mutateAsync, cellSaveDebounceMs, ownerId);

  if (ownerId !== activeOwnerId) {
    setActiveOwnerId(ownerId);
    setLastSavedAt(null);
    setLastSaveErrorAt(null);
  }

  const addSet = useApiMutation({
    mutationKey: ownerId ? mutationKeyFamily(ownerId) : undefined,
    // A new row is stamped on both axes, so it names both units (D22).
    mutationFn: (data: AddExerciseSetPayload) =>
      addSetRequest(ownerId!, {
        ...data,
        weightUnit: unitPreferences.weightUnit,
        distanceUnit: unitPreferences.distanceUnit,
      }),
    onSuccess: (serverSet) => {
      if (ownerId) patchCachedSets(ownerId, (sets) => [...sets, serverSet]);
      markSaved();
      onWriteSuccess?.();
    },
    onError: () => markError(),
    errorToast: "Couldn't add that exercise",
    invalidateQueries: ownerId ? addInvalidateQueries?.(ownerId) : undefined,
  });

  const deleteSet = useApiMutation({
    mutationKey: ownerId ? mutationKeyFamily(ownerId) : undefined,
    mutationFn: (setId: string) => deleteSetRequest(ownerId!, setId).then(() => setId),
    onMutate: async (setId: string) => {
      if (!ownerId) return undefined;
      await queryClient.cancelQueries({ queryKey: setsQueryKey(ownerId) });
      const prev = getSnapshot(ownerId);
      patchCachedSets(ownerId, (sets) => sets.filter((s) => s.id !== setId));
      return { prev };
    },
    onSuccess: () => {
      markSaved();
      onWriteSuccess?.();
    },
    onError: (_err, _vars, ctx) => {
      markError();
      const prev = (ctx as { prev?: TSnapshot } | undefined)?.prev;
      if (ownerId && prev) restoreSnapshot(ownerId, prev);
    },
    errorToast: "Couldn't remove that set",
    invalidateQueries: ownerId ? deleteInvalidateQueries?.(ownerId) : undefined,
  });

  const pendingMutationCount = useIsMutating({
    mutationKey: ownerId ? mutationKeyFamily(ownerId) : ["owner-sets-disabled"],
    exact: true,
  });

  return {
    updateSet,
    patchSetDebounced,
    flushPendingSetPatches,
    getPendingPatches,
    addSet,
    deleteSet,
    isSaving: pendingMutationCount > 0,
    lastSavedAt,
    lastSaveErrorAt,
    markSaved,
  };
}

import type { ExerciseSet, StructureBlockInput, StructureBlockScore, WorkoutLog } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";

import { useApiMutation } from "@/hooks/useApiMutation";
import { useExerciseSetsForOwner } from "@/hooks/useExerciseSetsForOwner";
import {
  api,
  type ParseFromImagePayload,
  QUERY_KEYS,
  type ReparseWorkoutTextPayload,
  type WorkoutReferenceTextPayload,
} from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

type WorkoutWithSets = WorkoutLog & { exerciseSets?: ExerciseSet[]; structureBlocks?: StructureBlockInput[] };

export function isLatestMutationSequence(seq: number, latestSeq: number | undefined): boolean {
  return seq === latestSeq;
}

export function mergeServerStructureBlock(
  currentBlocks: StructureBlockInput[] | undefined,
  serverBlocks: StructureBlockInput[],
  blockId: string,
): StructureBlockInput[] {
  const serverBlock = serverBlocks.find((block) => block.id === blockId);
  if (!serverBlock) return serverBlocks;
  const current = currentBlocks ?? [];
  if (current.length === 0) return serverBlocks;

  let replaced = false;
  const next = current.map((block) => {
    if (block.id !== blockId) return block;
    replaced = true;
    return serverBlock;
  });
  return replaced ? next : serverBlocks;
}

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

function isTimeoutLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("request timed out") ||
    message.includes("timeouterror") ||
    message.includes("aborterror")
  );
}

function isWorkoutNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("404") && message.includes("workout not found");
}

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

  const patchCachedStructureBlock = (
    targetWorkoutId: string,
    blockId: string,
    serverBlocks: StructureBlockInput[],
  ) => {
    queryClient.setQueryData<WorkoutWithSets>(QUERY_KEYS.workout(targetWorkoutId), (prev) =>
      prev
        ? { ...prev, structureBlocks: mergeServerStructureBlock(prev.structureBlocks, serverBlocks, blockId) }
        : prev,
    );
  };

  const {
    updateSet,
    patchSetDebounced,
    flushPendingSetPatches,
    addSet,
    deleteSet,
    isSaving,
    lastSavedAt,
    lastSaveErrorAt,
    markSaved,
  } = useExerciseSetsForOwner<WorkoutWithSets>({
    ownerId: workoutId,
    mutationKeyFamily: workoutSetsMutationKey,
    setsQueryKey: QUERY_KEYS.workout,
    patchCachedSets,
    getSnapshot: (id) => queryClient.getQueryData<WorkoutWithSets>(QUERY_KEYS.workout(id)),
    restoreSnapshot: (id, snapshot) => queryClient.setQueryData(QUERY_KEYS.workout(id), snapshot),
    updateSetRequest: (id, setId, data) => api.workouts.updateSet(id, setId, data),
    addSetRequest: (id, data) => api.workouts.addSet(id, data),
    deleteSetRequest: (id, setId) => api.workouts.deleteSet(id, setId),
    addInvalidateQueries: (id) => [QUERY_KEYS.workoutHistory(id)],
    deleteInvalidateQueries: (id) => [QUERY_KEYS.workout(id), QUERY_KEYS.workoutHistory(id)],
    cellSaveDebounceMs: CELL_SAVE_DEBOUNCE_MS,
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
  // workoutId via the consumer's hydration effect. Errors surface
  // through the `useApiMutation` toast layer.
  const reparseFreeText = useApiMutation({
    mutationFn: (payload?: ReparseWorkoutTextPayload) =>
      api.workouts.reparse(workoutId!, payload),
    invalidateQueries: workoutId
      ? [QUERY_KEYS.workout(workoutId), QUERY_KEYS.workoutHistory(workoutId)]
      : undefined,
    successToast: "Legacy workout converted",
    // No error toast — reparse failure is a best-effort fallback, not a
    // user-initiated action. Empty state + coach's prescription remain
    // visible, which is the graceful degradation path.
  });

  // Photo sibling of reparseFreeText — takes a freshly-captured image and
  // REPLACES the workout's structured sets with the parsed rows. User-
  // initiated (tap Photo → Parse in the dialog), so it DOES surface an
  // error toast.
  const reparseFromImage = useApiMutation({
    mutationFn: (payload: ParseFromImagePayload) =>
      api.workouts.reparseFromImage(workoutId!, payload),
    invalidateQueries: workoutId
      ? [QUERY_KEYS.workout(workoutId), QUERY_KEYS.workoutHistory(workoutId)]
      : undefined,
    errorToast: (error) =>
      isTimeoutLikeError(error)
        ? {
            title: "Parsing took too long — please retry.",
            description: "The image may still finish in the background. Refresh to check before retaking.",
          }
        : { title: "Couldn't parse that photo — try a clearer shot." },
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
    errorToast: (error) =>
      isWorkoutNotFoundError(error)
        ? {
            title: "That workout was just changed",
            description: "Refresh to sync the latest entry, then try again.",
          }
        : { title: "Couldn't save prescription" },
  });

  const updateStructure = useApiMutation({
    mutationKey: workoutId ? workoutSetsMutationKey(workoutId) : undefined,
    mutationFn: (structureBlocks: StructureBlockInput[]) =>
      api.workouts.update(workoutId!, { structureBlocks }),
    onMutate: async (structureBlocks) => {
      if (!workoutId) return undefined;
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.workout(workoutId) });
      const prev = queryClient.getQueryData<WorkoutWithSets>(QUERY_KEYS.workout(workoutId));
      patchCachedWorkout({ structureBlocks });
      return { prev };
    },
    onSuccess: () => {
      markSaved();
      if (workoutId) {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workout(workoutId) }).catch(() => undefined);
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => undefined);
      }
    },
    onError: (_err, _vars, ctx) => {
      const prev = (ctx as { prev?: WorkoutWithSets } | undefined)?.prev;
      if (workoutId && prev) queryClient.setQueryData(QUERY_KEYS.workout(workoutId), prev);
    },
    errorToast: "Couldn't save workout blocks",
  });

  const blockScoreSeqByKeyRef = useRef(new Map<string, number>());
  const blockScoreSeqCounterRef = useRef(0);
  const updateBlockScore = useApiMutation<
    { structureBlocks: StructureBlockInput[] },
    Error,
    { blockId: string; score: StructureBlockScore | null },
    { blockId: string; seq: number; sequenceKey: string; workoutId: string }
  >({
    mutationKey: workoutId ? workoutSetsMutationKey(workoutId) : undefined,
    mutationFn: ({ blockId, score }: { blockId: string; score: StructureBlockScore | null }) =>
      api.workouts.updateBlockScore(workoutId!, blockId, score),
    onMutate: ({ blockId }) => {
      const activeWorkoutId = workoutId!;
      blockScoreSeqCounterRef.current += 1;
      const seq = blockScoreSeqCounterRef.current;
      const sequenceKey = `${activeWorkoutId}:${blockId}`;
      blockScoreSeqByKeyRef.current.set(sequenceKey, seq);
      return { blockId, seq, sequenceKey, workoutId: activeWorkoutId };
    },
    onSuccess: (data, _vars, ctx) => {
      if (!isLatestMutationSequence(ctx.seq, blockScoreSeqByKeyRef.current.get(ctx.sequenceKey))) return;
      patchCachedStructureBlock(ctx.workoutId, ctx.blockId, data.structureBlocks);
      markSaved();
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => undefined);
    },
    errorToast: "Couldn't save block score",
  });

  const updateReference = useApiMutation({
    mutationKey: workoutId ? workoutSetsMutationKey(workoutId) : undefined,
    mutationFn: (patch: WorkoutReferenceTextPayload) =>
      api.workouts.update(workoutId!, patch),
    onMutate: async (patch) => {
      if (!workoutId) return undefined;
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.workout(workoutId) });
      const prev = queryClient.getQueryData<WorkoutWithSets>(QUERY_KEYS.workout(workoutId));
      patchCachedWorkout(patch);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      const prev = (ctx as { prev?: WorkoutWithSets } | undefined)?.prev;
      if (workoutId && prev) {
        queryClient.setQueryData(QUERY_KEYS.workout(workoutId), prev);
      }
    },
    onSuccess: () => {
      markSaved();
    },
    errorToast: (error) =>
      isWorkoutNotFoundError(error)
        ? {
            title: "That workout was just changed",
            description: "Refresh to sync the latest entry, then try again.",
          }
        : { title: "Couldn't save reference notes" },
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
      if (!isLatestMutationSequence(ctx.seq, rpeSeqPerWorkoutRef.current.get(forWorkoutId))) return;
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

  // Connect/disconnect this workout to a plan day. Optimistically patches the
  // cached workout's planId/planDayId so the picker reflects the choice
  // instantly; invalidates timeline + plans so the workout moves into (or out
  // of) the plan-day slot and the day's completion state refreshes. The server
  // derives planId from the day, so the request only carries planDayId.
  const updatePlanDay = useApiMutation({
    mutationFn: ({ planDayId }: { planId: string | null; planDayId: string | null }) =>
      api.workouts.assignPlanDay(workoutId!, planDayId),
    onMutate: async ({ planId, planDayId }: { planId: string | null; planDayId: string | null }) => {
      if (!workoutId) return undefined;
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.workout(workoutId) });
      const prev = queryClient.getQueryData<WorkoutWithSets>(QUERY_KEYS.workout(workoutId));
      patchCachedWorkout({ planId, planDayId });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      const prev = (ctx as { prev?: WorkoutWithSets } | undefined)?.prev;
      if (workoutId && prev) {
        queryClient.setQueryData(QUERY_KEYS.workout(workoutId), prev);
      }
    },
    invalidateQueries: workoutId
      ? [QUERY_KEYS.workout(workoutId), QUERY_KEYS.timeline, QUERY_KEYS.plans]
      : [QUERY_KEYS.timeline, QUERY_KEYS.plans],
    successToast: "Updated plan link",
    errorToast: "Couldn't update plan link",
  });

  return {
    workout: workoutQuery.data,
    history: historyQuery.data,
    isLoading: workoutQuery.isLoading,
    isError: workoutQuery.isError,
    isHydrating,
    isSaving,
    lastSavedAt,
    lastSaveErrorAt,
    updateSet,
    patchSetDebounced,
    flushPendingSetPatches,
    addSet,
    deleteSet,
    seedFromPlan,
    reparseFreeText,
    reparseFromImage,
    updateNote,
    updatePrescription,
    updateStructure,
    updateBlockScore,
    updateReference,
    updateFocus,
    updateRpe,
    updatePlanDay,
  };
}

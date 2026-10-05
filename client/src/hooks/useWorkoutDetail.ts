import type { ExerciseSet, StructureBlockInput, StructureBlockScore, WorkoutLog } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { EDIT_SAVE_DEBOUNCE_MS } from "@/components/workout-structure/editSaveDebounce";
import {
  applySetRelinks,
  relinksForSets,
  revertSetRelinks,
  type SetRelink,
  type StepLinkMove,
} from "@/components/workout-structure/stepLinks";
import { useApiMutation } from "@/hooks/useApiMutation";
import { useExerciseSetsForOwner } from "@/hooks/useExerciseSetsForOwner";
import {
  api,
  type ParseFromImagePayload,
  QUERY_KEYS,
  type ReparseWorkoutTextPayload,
  type WorkoutDetail,
  type WorkoutReferenceTextPayload,
} from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import {
  flushWorkoutWriteInvalidation,
  scheduleWorkoutWriteInvalidation,
  WORKOUT_DERIVED_NUTRITION_QUERY_KEYS,
} from "@/lib/workoutInvalidation";

type WorkoutWithSets = WorkoutDetail;

interface StructureSaveVariables {
  /** Named here, not read from the render: a save sent as the sheet closes still reaches its workout. */
  readonly workoutId: string;
  readonly structureBlocks: StructureBlockInput[];
  /** Rows that follow the steps this save renumbers, saved in the same request (CL15). */
  readonly relinks: SetRelink[];
}

interface StructureSaveContext {
  readonly prevBlocks: StructureBlockInput[] | undefined;
  readonly prevSets: ExerciseSet[];
}

// One block save at a time, across every sheet that saves blocks: TanStack
// runs mutations that share a scope in order. The id is fixed rather than per
// workout because a pending mutation takes the latest render's options, and a
// closed sheet's options name no workout (U3, CODEBASE_ANALYSIS_2026-10-03).
const WORKOUT_STRUCTURE_SAVE_SCOPE = { id: "workout-structure-save" };

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
 * What a seed, re-parse or photo parse refreshes: the workout and its
 * history, plus the reads built from its training load (the day's periodised
 * target, the Timeline fuel chips and the Fuelling block), since the load is
 * computed from the sets these replace. Session fuelling reads no sets.
 * CL19 (CODEBASE_ANALYSIS_2026-10-03)
 */
function setReplacementQueryKeys(workoutId: string) {
  return [
    QUERY_KEYS.workout(workoutId),
    QUERY_KEYS.workoutHistory(workoutId),
    QUERY_KEYS.nutritionDayPrefix,
    QUERY_KEYS.nutritionRangePrefix,
    QUERY_KEYS.nutritionBlockPrefix,
  ];
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

  // Snapshot ONLY the fields a mutation writes, so its rollback restores
  // exactly those. Every field of the workout — the sets, the title, each
  // block score — lives in this one cache entry, so restoring a whole-workout
  // snapshot on error silently reverts whatever succeeded while the failing
  // request was in flight. updateFocus has always scoped its rollback for
  // that reason; these helpers make it the rule for every field mutation.
  const snapshotWorkoutFields = (
    keys: readonly (keyof WorkoutWithSets)[],
  ): Partial<WorkoutWithSets> | undefined => {
    if (!workoutId) return undefined;
    const prev = queryClient.getQueryData<WorkoutWithSets>(QUERY_KEYS.workout(workoutId));
    if (!prev) return undefined;
    return Object.fromEntries(keys.map((key) => [key, prev[key]]));
  };

  const restoreWorkoutFields = (snapshot: Partial<WorkoutWithSets> | undefined) => {
    if (!workoutId || !snapshot) return;
    queryClient.setQueryData<WorkoutWithSets>(QUERY_KEYS.workout(workoutId), (curr) =>
      curr ? { ...curr, ...snapshot } : curr,
    );
  };

  /**
   * onMutate for every field mutation: stop in-flight refetches, snapshot the
   * fields this patch is about to overwrite, then apply it optimistically.
   */
  const beginFieldPatch = async (patch: Partial<WorkoutWithSets>) => {
    if (!workoutId) return undefined;
    await queryClient.cancelQueries({ queryKey: QUERY_KEYS.workout(workoutId) });
    const prev = snapshotWorkoutFields(Object.keys(patch) as (keyof WorkoutWithSets)[]);
    patchCachedWorkout(patch);
    return { prev };
  };

  /** onError partner of beginFieldPatch. */
  const rollbackFields = (ctx: unknown) => {
    restoreWorkoutFields((ctx as { prev?: Partial<WorkoutWithSets> } | undefined)?.prev);
  };

  const patchCachedSets = (id: string, updater: (sets: ExerciseSet[]) => ExerciseSet[]) => {
    queryClient.setQueryData<WorkoutWithSets>(QUERY_KEYS.workout(id), (prev) => {
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
    // Set edits move PRs, exercise analytics and the training overview just as
    // much as logging the workout does — same funnel the workout writes use,
    // but coalesced: the timeline, overview and PR queries are all active
    // under this sheet, so invalidating per cell save refetched all three on
    // every keystroke's PATCH. One trailing invalidation per burst instead,
    // flushed the moment the sheet closes (effect below).
    onWriteSuccess: scheduleWorkoutWriteInvalidation,
    // The cell inputs' debounce, lifted here for the same reason as
    // usePlanDayExercises: the Save button needs a flush seam.
    cellSaveDebounceMs: EDIT_SAVE_DEBOUNCE_MS,
  });

  // Closing the sheet (or switching workouts) ends the editing burst: run any
  // pending derived-view invalidation now so the timeline behind the sheet is
  // fresh when the athlete lands back on it, rather than up to
  // WORKOUT_WRITE_INVALIDATION_DELAY_MS later.
  useEffect(() => () => flushWorkoutWriteInvalidation(), [workoutId]);

  const seedFromPlan = useApiMutation({
    mutationFn: () => api.workouts.seedFromPlan(workoutId!),
    // Seed is idempotent on the server, so we can let React Query refetch
    // the workout once it succeeds rather than reconciling inline.
    invalidateQueries: workoutId ? setReplacementQueryKeys(workoutId) : undefined,
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
    invalidateQueries: workoutId ? setReplacementQueryKeys(workoutId) : undefined,
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
    invalidateQueries: workoutId ? setReplacementQueryKeys(workoutId) : undefined,
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
    onMutate: (notes) => beginFieldPatch({ notes }),
    onError: (_err, _vars, ctx) => rollbackFields(ctx),
    errorToast: "Couldn't save that note",
  });

  // Debounced PATCH for the workout's focus (displayed title). Tagged with
  // workoutSetsMutationKey so the ExerciseTable's save pill reflects title
  // edits too — one unified "Saving…/Saved" signal across the whole dialog.
  // Optimistic: patches the cached workout so the heading updates without a
  // round-trip; rollback restores ONLY the focus field on error, so a
  // concurrently-succeeded set edit survives this one failing. Timeline is invalidated
  // in onSuccess so card copy reflects the new title within a refetch (we
  // don't have selectedPlanId here, so optimistic timeline patching would
  // have to traverse every cached variant — invalidate is simpler and the
  // staleness window is ~100ms).
  const updateFocus = useApiMutation({
    mutationKey: workoutId ? workoutSetsMutationKey(workoutId) : undefined,
    mutationFn: (focus: string) => api.workouts.update(workoutId!, { focus }),
    onMutate: (focus) => beginFieldPatch({ focus }),
    onSuccess: async () => {
      markSaved();
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline });
    },
    onError: (_err, _vars, ctx) => rollbackFields(ctx),
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
    onMutate: (patch) => {
      const optimistic: Partial<WorkoutWithSets> = {};
      if (patch.mainWorkout !== undefined) optimistic.mainWorkout = patch.mainWorkout ?? "";
      if (patch.accessory !== undefined) optimistic.accessory = patch.accessory;
      if (patch.notes !== undefined) optimistic.notes = patch.notes;
      return beginFieldPatch(optimistic);
    },
    onError: (_err, _vars, ctx) => rollbackFields(ctx),
    errorToast: (error) =>
      isWorkoutNotFoundError(error)
        ? {
            title: "That workout was just changed",
            description: "Refresh to sync the latest entry, then try again.",
          }
        : { title: "Couldn't save prescription" },
  });

  // The blocks and the rows that follow a reordered or removed step go in ONE
  // request, applied in one transaction. Sent as set PATCHes ahead of the
  // blocks, a partial failure left rows on the new numbering beside blocks
  // stored with the old one. CL15 (CODEBASE_ANALYSIS_2026-10-03)
  const updateStructure = useApiMutation<
    WorkoutLog,
    Error,
    StructureSaveVariables,
    StructureSaveContext | undefined
  >({
    mutationKey: workoutId ? workoutSetsMutationKey(workoutId) : undefined,
    scope: WORKOUT_STRUCTURE_SAVE_SCOPE,
    mutationFn: ({ workoutId: target, structureBlocks, relinks }) =>
      api.workouts.update(target, { structureBlocks, relinks }),
    onMutate: async ({ workoutId: target, structureBlocks, relinks }) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.workout(target) });
      const prev = queryClient.getQueryData<WorkoutWithSets>(QUERY_KEYS.workout(target));
      if (!prev) return undefined;
      const prevSets = prev.exerciseSets ?? [];
      queryClient.setQueryData<WorkoutWithSets>(QUERY_KEYS.workout(target), (curr) =>
        curr ? { ...curr, structureBlocks, exerciseSets: applySetRelinks(curr.exerciseSets ?? [], relinks) } : curr,
      );
      return { prevBlocks: prev.structureBlocks, prevSets };
    },
    onSuccess: (_log, { workoutId: target }) => {
      markSaved();
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workout(target) }).catch(() => undefined);
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => undefined);
    },
    // Puts back the blocks and only the rows this save moved, so a set edit
    // that landed meanwhile survives the rollback.
    onError: (_err, { workoutId: target, relinks }, ctx) => {
      if (!ctx) return;
      queryClient.setQueryData<WorkoutWithSets>(QUERY_KEYS.workout(target), (curr) =>
        curr
          ? {
              ...curr,
              structureBlocks: ctx.prevBlocks,
              exerciseSets: revertSetRelinks(curr.exerciseSets ?? [], relinks, ctx.prevSets),
            }
          : curr,
      );
    },
    errorToast: "Couldn't save workout blocks",
  });

  /**
   * The block builder's save: the edited blocks plus the relinks for the rows
   * on every step it renumbered, read from the cache so they include an earlier
   * save's moves. Rejects when the save fails, so the builder shows what is
   * stored again.
   *
   * A row put on a block step in the pause before this save is still queued,
   * or was sent as the sheet closed and has not landed, and names the
   * numbering the save renumbers. Landed first, it is one of the rows the
   * relinks move; landed after, it sat on its old step number under the new
   * numbering. The flush waits for both. CL15 (CODEBASE_ANALYSIS_2026-10-03)
   */
  const saveStructure = async (structureBlocks: StructureBlockInput[], moves: readonly StepLinkMove[]) => {
    if (!workoutId) throw new Error("There's no workout to save these blocks to.");
    await flushPendingSetPatches();
    const cached = queryClient.getQueryData<WorkoutWithSets>(QUERY_KEYS.workout(workoutId));
    const relinks = relinksForSets(cached?.exerciseSets ?? [], moves);
    return updateStructure.mutateAsync({ workoutId, structureBlocks, relinks });
  };

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
    onMutate: (patch) => beginFieldPatch(patch),
    onError: (_err, _vars, ctx) => rollbackFields(ctx),
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
        // The RPE sizes this session's fuelling targets, picks the day's primary
        // session for its meal targets and weights its training load: the
        // fuelling panel beside it kept the old targets for its staleTime.
        // CL19 (CODEBASE_ANALYSIS_2026-10-03)
        ...WORKOUT_DERIVED_NUTRITION_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ]);
    },
    errorToast: "Couldn't save that RPE",
  });

  // Inline session-time edit for a manual log without a device start time.
  // Optimistic like updateFocus: patch the cached workout so the picker
  // reflects the choice immediately. The day's per-meal fuel timing lives in
  // its summary, so that refreshes with the timeline; the timeline alone left
  // the meal targets on the old timing. Session fuelling windows only by a device
  // start time. Roll back only timeOfDayMin on error.
  // CL19 (CODEBASE_ANALYSIS_2026-10-03)
  const updateTimeOfDay = useApiMutation({
    mutationFn: (timeOfDayMin: number | null) =>
      api.workouts.update(workoutId!, { timeOfDayMin }),
    onMutate: (timeOfDayMin) => beginFieldPatch({ timeOfDayMin }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.nutritionDayPrefix }),
      ]);
    },
    onError: (_err, _vars, ctx) => rollbackFields(ctx),
    errorToast: "Couldn't save the session time",
  });

  // Does this session count as training? Device imports arrive with a value
  // derived from the sport type (a dog walk lands as "no"); this is how the
  // athlete overrules that for one session. Analytics invalidates too, because
  // flipping it changes the session counts, the streak and the training mix.
  const updateCountsAsTraining = useApiMutation({
    mutationFn: (countsAsTraining: boolean) =>
      api.workouts.update(workoutId!, { countsAsTraining }),
    onMutate: (countsAsTraining) => beginFieldPatch({ countsAsTraining }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trainingOverview }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.personalRecords }),
      ]);
    },
    onError: (_err, _vars, ctx) => rollbackFields(ctx),
    errorToast: "Couldn't change whether this counts as training",
  });

  // Connect/disconnect this workout to a plan day. Optimistically patches the
  // cached workout's planId/planDayId so the picker reflects the choice
  // instantly; invalidates timeline + plans so the workout moves into (or out
  // of) the plan-day slot and the day's completion state refreshes. The server
  // derives planId from the day, so the request only carries planDayId.
  const updatePlanDay = useApiMutation({
    mutationFn: ({ planDayId }: { planId: string | null; planDayId: string | null }) =>
      api.workouts.assignPlanDay(workoutId!, planDayId),
    onMutate: ({ planId, planDayId }: { planId: string | null; planDayId: string | null }) =>
      beginFieldPatch({ planId, planDayId }),
    onError: (_err, _vars, ctx) => rollbackFields(ctx),
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
    saveStructure,
    updateBlockScore,
    updateReference,
    updateFocus,
    updateRpe,
    updateTimeOfDay,
    updateCountsAsTraining,
    updatePlanDay,
  };
}

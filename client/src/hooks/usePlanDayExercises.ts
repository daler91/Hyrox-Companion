import type { ExerciseSet, StructureBlockInput } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { EDIT_SAVE_DEBOUNCE_MS } from "@/components/workout-structure/editSaveDebounce";
import {
  applySetRelinks,
  relinksForSets,
  revertSetRelinks,
  type SetRelink,
  type StepLinkMove,
} from "@/components/workout-structure/stepLinks";
import { useToast } from "@/hooks/use-toast";
import { useApiMutation } from "@/hooks/useApiMutation";
import { useExerciseSetsForOwner } from "@/hooks/useExerciseSetsForOwner";
import { api, type ParseFromImagePayload, type PlanDayReparseTextPayload, QUERY_KEYS } from "@/lib/api";
import type { ReparseResponse } from "@/lib/api/constants";
import { parseApiError } from "@/lib/apiError";
import { queryClient } from "@/lib/queryClient";

// Tag every plan-day set mutation with this key family so useIsMutating
// can count ALL in-flight writes for the current plan day — not just
// the most recent one. useMutation.isPending only reflects the latest
// mutate() call, which would hide concurrent PATCHes when a row edit
// fans out to multiple set ids.
const planDaySetsMutationKey = (planDayId: string) => ["plan-day-sets", planDayId] as const;

// Switching the sheet to another plan day changes this key, which detaches the
// observer from the first day's in-flight reparse (its parsing state is not
// the new day's) and leaves that parse its own options. Closing the sheet sets
// no key, so the parse stays observed and reopening the day still shows it
// running (CL21, CODEBASE_ANALYSIS_2026-10-03).
const planDayReparseMutationKey = (planDayId: string) => ["plan-day-reparse", planDayId] as const;

type PlanDayExerciseData = {
  exerciseSets: ExerciseSet[];
  structureBlocks: StructureBlockInput[];
};

interface StructureSaveVariables {
  /** Named here, not read from the render: a save sent as the sheet closes still reaches its day. */
  readonly planDayId: string;
  readonly structureBlocks: StructureBlockInput[];
  /** Rows that follow the steps this save renumbers, saved in the same request (CL15). */
  readonly relinks: SetRelink[];
}

interface StructureSaveContext {
  readonly prev: PlanDayExerciseData;
}

// One plan-day block save at a time: TanStack runs mutations that share a
// scope in order. Fixed rather than per day because a pending mutation takes
// the latest render's options, and a closed sheet's options name no day
// (U3, CODEBASE_ANALYSIS_2026-10-03).
const PLAN_DAY_STRUCTURE_SAVE_SCOPE = { id: "plan-day-structure-save" };

type PlanDayExerciseQueryData = PlanDayExerciseData | ExerciseSet[];

function normalizePlanDayExerciseData(data: PlanDayExerciseQueryData | undefined): PlanDayExerciseData | undefined {
  if (!data) return undefined;
  return Array.isArray(data) ? { exerciseSets: data, structureBlocks: [] } : data;
}

function isTimeoutLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("request timed out") ||
    message.includes("timeouterror") ||
    message.includes("aborterror")
  );
}

type ApiErrorStatusAndCode = { status: number | null; code: string | null };
type UnknownRecord = Record<string, unknown>;

function toUnknownRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
}

function extractApiErrorStatus(error: UnknownRecord): number | null {
  if (typeof error.status === "number") return error.status;

  const response = toUnknownRecord(error.response);
  return typeof response?.status === "number" ? response.status : null;
}

function extractApiErrorCode(error: UnknownRecord): string | null {
  if (typeof error.code === "string") return error.code;

  const payload = toUnknownRecord(error.payload);
  return typeof payload?.code === "string" ? payload.code : null;
}

function extractApiErrorStatusAndCode(error: unknown): ApiErrorStatusAndCode {
  const asRecord = toUnknownRecord(error);
  if (!asRecord) return { status: null, code: null };

  const status = extractApiErrorStatus(asRecord);
  const directCode = extractApiErrorCode(asRecord);
  if (directCode) return { status, code: directCode };

  // apiRequest's `${status}: ${body}` message, read by the one shared parser
  // rather than a private copy. CL34 (CODEBASE_ANALYSIS_2026-10-03)
  const parsed = parseApiError(error);
  return { status: status ?? parsed?.status ?? null, code: parsed?.code ?? null };
}

function isUpstreamAiStatusOrCode({ status, code }: ApiErrorStatusAndCode): boolean {
  return status === 502 || status === 504 || code === "AI_UPSTREAM_FAILURE" || code === "AI_UPSTREAM_TIMEOUT";
}

function isUpstreamAiError(error: unknown): boolean {
  return isUpstreamAiStatusOrCode(extractApiErrorStatusAndCode(error));
}

/** Refetch the rows a reparse replaced, for the day it was fired on (CL21, CODEBASE_ANALYSIS_2026-10-03). */
function invalidateReparsedDay(planDayId: string) {
  return queryClient.invalidateQueries({ queryKey: QUERY_KEYS.planDayExercises(planDayId) });
}

function buildPartialParseWarningToast(data: ReparseResponse) {
  if ((data.rejectedCount ?? 0) <= 0) return undefined;
  const rejectedCount = data.rejectedCount ?? 0;
  return {
    title: `Saved ${data.setCount ?? data.exercises?.length ?? 0} rows`,
    description: `Skipped ${rejectedCount} line${rejectedCount === 1 ? "" : "s"} that could not be interpreted.`,
  };
}

/**
 * Mutation + query bundle for a plan day's prescribed exercise sets.
 * Used by the v2 workout detail dialog when a planned entry is open so
 * the athlete can tweak the coach's prescription before marking
 * complete. Mirrors useWorkoutDetail's updateSet / addSet / deleteSet
 * shape so the ExerciseTable component can plug in either source
 * without knowing which owner it's writing to.
 *
 * When Mark complete fires, the server's `createWorkoutInTx` copy-from-plan
 * path copies whatever rows this hook has persisted into the new workoutLog —
 * so these edits are the starting state of the logged workout.
 */
export function usePlanDayExercises(planDayId: string | null) {
  const { toast } = useToast();
  const [parseFailureState, setParseFailureState] = useState<{
    ownerId: string | null;
    retry: null | (() => void);
  }>({ ownerId: null, retry: null });

  const queryKey = planDayId
    ? QUERY_KEYS.planDayExercises(planDayId)
    : ["plan-day-exercises-disabled"];
  const exercisesQuery = useQuery<PlanDayExerciseQueryData>({
    queryKey,
    queryFn: () => api.plans.getDayExercises(planDayId!),
    enabled: !!planDayId,
  });

  const patchCachedSets = (id: string, updater: (sets: ExerciseSet[]) => ExerciseSet[]) => {
    queryClient.setQueryData<PlanDayExerciseData>(QUERY_KEYS.planDayExercises(id), (prev) => {
      const data = prev ?? { exerciseSets: [], structureBlocks: [] };
      return { ...data, exerciseSets: updater(data.exerciseSets) };
    });
  };

  const exerciseSetOps = useExerciseSetsForOwner({
    ownerId: planDayId,
    mutationKeyFamily: planDaySetsMutationKey,
    setsQueryKey: QUERY_KEYS.planDayExercises,
    patchCachedSets,
    getSnapshot: (id) => queryClient.getQueryData<PlanDayExerciseData>(QUERY_KEYS.planDayExercises(id)),
    restoreSnapshot: (id, snapshot) => queryClient.setQueryData(QUERY_KEYS.planDayExercises(id), snapshot),
    updateSetRequest: (id, setId, data) => api.plans.updateDayExercise(id, setId, data),
    addSetRequest: (id, data) => api.plans.addDayExercise(id, data),
    deleteSetRequest: (id, setId) => api.plans.deleteDayExercise(id, setId),
    deleteInvalidateQueries: (id) => [QUERY_KEYS.planDayExercises(id)],
    // The cell inputs' debounce, lifted to the hook because LogSheet must flush
    // pending cell edits before "log as planned" (createWorkoutInTx copies the
    // persisted plan-day rows) and before it closes.
    cellSaveDebounceMs: EDIT_SAVE_DEBOUNCE_MS,
  });
  const { updateSet, patchSetDebounced, flushPendingSetPatches, getPendingPatches, addSet, deleteSet, isSaving, lastSavedAt, lastSaveErrorAt } = exerciseSetOps;

  // Plan-day Parse: POST /reparse -> the AI provider parses mainWorkout/accessory into
  // structured rows, replacing this day's prescription. React Query's server
  // state is refreshed via an explicit query invalidation rather than
  // reconciling in-hand because the response shape (`exercises[]`) is the
  // parsed-exercise DTO, not ExerciseSet rows.
  //
  // The plan day each parse wrote to rides in its onMutate context, captured
  // when it was fired, and its invalidation keys off that. A render-time
  // `invalidateQueries` list was copied onto the pending parse by every
  // re-render, so once the sheet closed (`planDayId` null) a finishing parse
  // invalidated nothing, and the reopened sheet showed the replaced rows and
  // PATCHed set ids that no longer existed (CL21, CODEBASE_ANALYSIS_2026-10-03).
  const reparseFreeText = useApiMutation({
    mutationKey: planDayId ? planDayReparseMutationKey(planDayId) : undefined,
    mutationFn: (payload?: PlanDayReparseTextPayload) => {
      if (!planDayId) return Promise.resolve(null);
      return api.plans.reparseDay(planDayId, payload);
    },
    onMutate: () => ({ ownerId: planDayId }),
    onSuccess: async (data, _variables, context) => {
      if (!context?.ownerId) return;
      await invalidateReparsedDay(context.ownerId);
      setParseFailureState((prev) =>
        prev.ownerId === context.ownerId ? { ownerId: null, retry: null } : prev,
      );
      const toastData = data ? buildPartialParseWarningToast(data) : undefined;
      if (toastData) toast(toastData);
    },
    onError: (_error, _variables, context) => {
      if (!context?.ownerId) return;
      const ownerId = context.ownerId;
      setParseFailureState({
        ownerId,
        retry: () => reparseFreeText.mutate(undefined),
      });
    },
    errorToast: (error) =>
      isUpstreamAiError(error)
        ? {
            title: "AI service temporarily unavailable",
            description: "Please retry in a moment.",
          }
        : { title: "Parse failed — try rewording and retry." },
  });

  // Photo sibling — mirrors reparseFreeText but sources the exercises
  // from a captured image. Same replace semantics: the plan day's
  // existing structured rows are wiped before the new ones land.
  const reparseFromImage = useApiMutation({
    mutationKey: planDayId ? planDayReparseMutationKey(planDayId) : undefined,
    mutationFn: (payload: ParseFromImagePayload) => {
      if (!planDayId) return Promise.resolve(null);
      return api.plans.reparseDayFromImage(planDayId, payload);
    },
    onMutate: (payload) => ({ ownerId: planDayId, payload }),
    onSuccess: async (data, _variables, context) => {
      if (!context?.ownerId) return;
      await invalidateReparsedDay(context.ownerId);
      setParseFailureState((prev) =>
        prev.ownerId === context.ownerId ? { ownerId: null, retry: null } : prev,
      );
      const toastData = data ? buildPartialParseWarningToast(data) : undefined;
      if (toastData) toast(toastData);
    },
    onError: (error, _variables, context) => {
      if (!context?.ownerId) return;
      const ownerId = context.ownerId;
      const payload = context.payload;
      setParseFailureState({
        ownerId,
        retry: payload ? () => reparseFromImage.mutate(payload) : null,
      });
    },
    errorToast: (error) =>
      isTimeoutLikeError(error)
        ? {
            title: "Parsing took too long — please retry.",
            description: "The image may still finish in the background. Refresh to check before retaking.",
          }
        : { title: "Couldn't parse that photo — try a clearer shot." },
  });

  const planData = useMemo(() => normalizePlanDayExerciseData(exercisesQuery.data), [exercisesQuery.data]);
  const hasStructuredRows = (planData?.exerciseSets.length ?? 0) > 0;
  const parseFailed = !!planDayId && !hasStructuredRows && parseFailureState.ownerId === planDayId;
  const retryParse = parseFailed ? parseFailureState.retry : null;

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
    mutationFn: (patch: { focus?: string; mainWorkout?: string | null; accessory?: string | null; notes?: string | null }) => {
      if (!planDayId) return Promise.resolve(null);
      return api.plans.updateDayWithoutPlan(planDayId, patch);
    },
    invalidateQueries: [QUERY_KEYS.timeline, QUERY_KEYS.plans],
    onSuccess: () => {
      exerciseSetOps.markSaved();
    },
    errorToast: "Couldn't save prescription",
  });

  // The blocks and the rows that follow a reordered or removed step go in ONE
  // request, applied in one transaction, and the day rides in the variables:
  // LogSheet used to send the relinks itself and then the blocks, so a sheet
  // closed in between saved the rows and dropped the blocks. CL15
  // (CODEBASE_ANALYSIS_2026-10-03)
  const updateStructure = useApiMutation<
    PlanDayExerciseData,
    Error,
    StructureSaveVariables,
    StructureSaveContext | undefined
  >({
    mutationKey: planDayId ? planDaySetsMutationKey(planDayId) : undefined,
    scope: PLAN_DAY_STRUCTURE_SAVE_SCOPE,
    mutationFn: ({ planDayId: target, structureBlocks, relinks }) =>
      api.plans.updateDayStructure(target, structureBlocks, relinks),
    onMutate: async ({ planDayId: target, structureBlocks, relinks }) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.planDayExercises(target) });
      const prev = normalizePlanDayExerciseData(
        queryClient.getQueryData<PlanDayExerciseQueryData>(QUERY_KEYS.planDayExercises(target)),
      );
      if (!prev) return undefined;
      queryClient.setQueryData<PlanDayExerciseData>(QUERY_KEYS.planDayExercises(target), {
        exerciseSets: applySetRelinks(prev.exerciseSets, relinks),
        structureBlocks,
      });
      return { prev };
    },
    onSuccess: (data, { planDayId: target }) => {
      queryClient.setQueryData(QUERY_KEYS.planDayExercises(target), data);
      exerciseSetOps.markSaved();
    },
    // Puts back the blocks and only the rows this save moved, so a set edit
    // that landed meanwhile survives the rollback.
    onError: (_err, { planDayId: target, relinks }, context) => {
      if (!context) return;
      queryClient.setQueryData<PlanDayExerciseQueryData>(QUERY_KEYS.planDayExercises(target), (current) => {
        const data = normalizePlanDayExerciseData(current);
        if (!data) return current;
        return {
          exerciseSets: revertSetRelinks(data.exerciseSets, relinks, context.prev.exerciseSets),
          structureBlocks: context.prev.structureBlocks,
        };
      });
    },
    invalidateQueries: [QUERY_KEYS.timeline, QUERY_KEYS.plans],
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
    if (!planDayId) throw new Error("There's no planned day to save these blocks to.");
    await flushPendingSetPatches();
    const cached = normalizePlanDayExerciseData(
      queryClient.getQueryData<PlanDayExerciseQueryData>(QUERY_KEYS.planDayExercises(planDayId)),
    );
    const relinks = relinksForSets(cached?.exerciseSets ?? [], moves);
    return updateStructure.mutateAsync({ planDayId, structureBlocks, relinks });
  };

  const exerciseSets = useMemo(() => planData?.exerciseSets ?? [], [planData]);
  const structureBlocks = useMemo(() => planData?.structureBlocks ?? [], [planData]);
  const getExerciseSetsWithPendingPatches = useCallback(() => {
    const pendingPatches = getPendingPatches();
    if (pendingPatches.length === 0) return exerciseSets;

    const patchesBySetId = new Map<string, Partial<ExerciseSet>>(
      pendingPatches.map(({ setId, patch }) => [setId, patch]),
    );
    return exerciseSets.map((set) => {
      const patch = patchesBySetId.get(set.id);
      return patch ? ({ ...set, ...patch }) : set;
    });
  }, [exerciseSets, getPendingPatches]);

  return {
    exerciseSets,
    structureBlocks,
    getExerciseSetsWithPendingPatches,
    isLoading: exercisesQuery.isLoading,
    isError: exercisesQuery.isError,
    error: exercisesQuery.error,
    isSaving,
    lastSavedAt,
    lastSaveErrorAt,
    updateSet,
    patchSetDebounced,
    flushPendingSetPatches,
    addSet,
    deleteSet,
    reparseFreeText,
    reparseFromImage,
    parseFailed,
    retryParse,
    updatePrescription,
    updateStructure,
    saveStructure,
  };
}

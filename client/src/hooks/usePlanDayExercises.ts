import type { ExerciseSet, StructureBlockInput } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { useToast } from "@/hooks/use-toast";
import { useApiMutation } from "@/hooks/useApiMutation";
import { useExerciseSetsForOwner } from "@/hooks/useExerciseSetsForOwner";
import { api, type ParseFromImagePayload, type PlanDayReparseTextPayload, QUERY_KEYS } from "@/lib/api";
import type { ReparseResponse } from "@/lib/api/constants";
import { queryClient } from "@/lib/queryClient";

// Tag every plan-day set mutation with this key family so useIsMutating
// can count ALL in-flight writes for the current plan day — not just
// the most recent one. useMutation.isPending only reflects the latest
// mutate() call, which would hide concurrent PATCHes when a row edit
// fans out to multiple set ids.
const planDaySetsMutationKey = (planDayId: string) => ["plan-day-sets", planDayId] as const;

// Same debounce window the cell inputs used to own. Lifted to the hook
// because the Save button needs to flush pending cell edits
// synchronously before regenerating the coach note; a per-component
// debounce has no flush seam.
const CELL_SAVE_DEBOUNCE_MS = 350;

type PlanDayExerciseData = {
  exerciseSets: ExerciseSet[];
  structureBlocks: StructureBlockInput[];
};

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

function parseStatusFromMessage(message: string, fallbackStatus: number | null): number | null {
  const statusMatch = /^(\d{3})\s*:/.exec(message);
  return fallbackStatus ?? (statusMatch ? Number.parseInt(statusMatch[1], 10) : null);
}

function parseCodeFromMessageJson(message: string): string | null {
  const jsonStart = message.indexOf("{");
  if (jsonStart < 0) return null;

  try {
    const parsed = JSON.parse(message.slice(jsonStart)) as { code?: unknown };
    return typeof parsed.code === "string" ? parsed.code : null;
  } catch {
    return null;
  }
}

function extractApiErrorStatusAndCode(error: unknown): ApiErrorStatusAndCode {
  const asRecord = toUnknownRecord(error);
  if (!asRecord) return { status: null, code: null };

  const status = extractApiErrorStatus(asRecord);
  const directCode = extractApiErrorCode(asRecord);
  if (directCode) return { status, code: directCode };

  const message = typeof asRecord.message === "string" ? asRecord.message : "";
  if (!message) return { status, code: null };

  const parsedStatus = parseStatusFromMessage(message, status);
  const parsedCode = parseCodeFromMessageJson(message);
  return { status: parsedStatus, code: parsedCode };
}

function isUpstreamAiStatusOrCode({ status, code }: ApiErrorStatusAndCode): boolean {
  return status === 502 || status === 504 || code === "AI_UPSTREAM_FAILURE" || code === "AI_UPSTREAM_TIMEOUT";
}

function isUpstreamAiError(error: unknown): boolean {
  return isUpstreamAiStatusOrCode(extractApiErrorStatusAndCode(error));
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

  const patchCachedSets = (updater: (sets: ExerciseSet[]) => ExerciseSet[]) => {
    if (!planDayId) return;
    queryClient.setQueryData<PlanDayExerciseData>(QUERY_KEYS.planDayExercises(planDayId), (prev) => {
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
    cellSaveDebounceMs: CELL_SAVE_DEBOUNCE_MS,
  });
  const { updateSet, patchSetDebounced, flushPendingSetPatches, getPendingPatches, addSet, deleteSet, isSaving, lastSavedAt, lastSaveErrorAt } = exerciseSetOps;

  // Plan-day Parse: POST /reparse -> the AI provider parses mainWorkout/accessory into
  // structured rows, replacing this day's prescription. React Query's server
  // state is refreshed via an explicit query invalidation rather than
  // reconciling in-hand because the response shape (`exercises[]`) is the
  // parsed-exercise DTO, not ExerciseSet rows.
  const reparseFreeText = useApiMutation({
    mutationFn: (payload?: PlanDayReparseTextPayload) => {
      if (!planDayId) return Promise.resolve(null);
      return api.plans.reparseDay(planDayId, payload);
    },
    invalidateQueries: planDayId ? [QUERY_KEYS.planDayExercises(planDayId)] : undefined,
    onMutate: () => ({ ownerId: planDayId }),
    onSuccess: (data, _variables, context) => {
      if (!context?.ownerId) return;
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
    mutationFn: (payload: ParseFromImagePayload) => {
      if (!planDayId) return Promise.resolve(null);
      return api.plans.reparseDayFromImage(planDayId, payload);
    },
    invalidateQueries: planDayId ? [QUERY_KEYS.planDayExercises(planDayId)] : undefined,
    onMutate: (payload) => ({ ownerId: planDayId, payload }),
    onSuccess: (data, _variables, context) => {
      if (!context?.ownerId) return;
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

  const updateStructure = useApiMutation({
    mutationKey: planDayId ? planDaySetsMutationKey(planDayId) : undefined,
    mutationFn: (next: StructureBlockInput[]) => {
      if (!planDayId) return Promise.resolve({ exerciseSets: [], structureBlocks: [] });
      return api.plans.updateDayStructure(planDayId, next);
    },
    onMutate: async (next) => {
      if (!planDayId) return undefined;
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.planDayExercises(planDayId) });
      const prev = queryClient.getQueryData<PlanDayExerciseData>(QUERY_KEYS.planDayExercises(planDayId));
      queryClient.setQueryData<PlanDayExerciseData>(QUERY_KEYS.planDayExercises(planDayId), (current) => ({
        exerciseSets: current?.exerciseSets ?? [],
        structureBlocks: next,
      }));
      return { prev };
    },
    onSuccess: (data) => {
      if (planDayId) {
        queryClient.setQueryData(QUERY_KEYS.planDayExercises(planDayId), data);
      }
      exerciseSetOps.markSaved();
    },
    onError: (_err, _variables, context) => {
      const prev = (context as { prev?: PlanDayExerciseData } | undefined)?.prev;
      if (planDayId && prev) queryClient.setQueryData(QUERY_KEYS.planDayExercises(planDayId), prev);
    },
    invalidateQueries: [QUERY_KEYS.timeline, QUERY_KEYS.plans],
    errorToast: "Couldn't save workout blocks",
  });

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
  };
}

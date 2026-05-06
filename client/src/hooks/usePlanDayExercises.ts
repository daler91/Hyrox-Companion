import type { ExerciseSet } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { useApiMutation } from "@/hooks/useApiMutation";
import { useExerciseSetsForOwner } from "@/hooks/useExerciseSetsForOwner";
import { api, type ParseFromImagePayload, QUERY_KEYS } from "@/lib/api";
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

function isTimeoutLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("request timed out") ||
    message.includes("timeouterror") ||
    message.includes("aborterror")
  );
}

function extractApiErrorStatusAndCode(error: unknown): { status: number | null; code: string | null } {
  if (!error || typeof error !== "object") return { status: null, code: null };
  const asRecord = error as Record<string, unknown>;

  const status = typeof asRecord.status === "number"
    ? asRecord.status
    : (typeof (asRecord.response as Record<string, unknown> | undefined)?.status === "number"
      ? ((asRecord.response as Record<string, unknown>).status as number)
      : null);

  const directCode = typeof asRecord.code === "string" ? asRecord.code : null;
  if (directCode) return { status, code: directCode };

  const payload = asRecord.payload;
  if (payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).code === "string") {
    return { status, code: (payload as Record<string, unknown>).code as string };
  }

  return { status, code: null };
}

function isUpstreamAiError(error: unknown): boolean {
  const { status, code } = extractApiErrorStatusAndCode(error);
  return status === 502 || status === 504 || code === "AI_UPSTREAM_FAILURE" || code === "AI_UPSTREAM_TIMEOUT";
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
  const [parseFailureState, setParseFailureState] = useState<{
    ownerId: string | null;
    retry: null | (() => void);
  }>({ ownerId: null, retry: null });

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

  const exerciseSetOps = useExerciseSetsForOwner({
    ownerId: planDayId,
    mutationKeyFamily: planDaySetsMutationKey,
    setsQueryKey: QUERY_KEYS.planDayExercises,
    patchCachedSets,
    getSnapshot: (id) => queryClient.getQueryData<ExerciseSet[]>(QUERY_KEYS.planDayExercises(id)),
    restoreSnapshot: (id, snapshot) => queryClient.setQueryData(QUERY_KEYS.planDayExercises(id), snapshot),
    updateSetRequest: (id, setId, data) => api.plans.updateDayExercise(id, setId, data),
    addSetRequest: (id, data) => api.plans.addDayExercise(id, data),
    deleteSetRequest: (id, setId) => api.plans.deleteDayExercise(id, setId),
    deleteInvalidateQueries: (id) => [QUERY_KEYS.planDayExercises(id)],
    cellSaveDebounceMs: CELL_SAVE_DEBOUNCE_MS,
  });
  const { updateSet, patchSetDebounced, flushPendingSetPatches, getPendingPatches, addSet, deleteSet, isSaving, lastSavedAt } = exerciseSetOps;

  // Plan-day Parse: POST /reparse → Gemini parses mainWorkout/accessory into
  // structured rows, replacing this day's prescription. React Query's server
  // state is refreshed via an explicit query invalidation rather than
  // reconciling in-hand because the response shape (`exercises[]`) is the
  // parsed-exercise DTO, not ExerciseSet rows.
  const reparseFreeText = useApiMutation({
    mutationFn: () => api.plans.reparseDay(planDayId!),
    invalidateQueries: planDayId ? [QUERY_KEYS.planDayExercises(planDayId)] : undefined,
    onMutate: () => ({ ownerId: planDayId }),
    onSuccess: (_data, _variables, context) => {
      if (!context?.ownerId) return;
      setParseFailureState((prev) =>
        prev.ownerId === context.ownerId ? { ownerId: null, retry: null } : prev,
      );
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
    mutationFn: (payload: ParseFromImagePayload) =>
      api.plans.reparseDayFromImage(planDayId!, payload),
    invalidateQueries: planDayId ? [QUERY_KEYS.planDayExercises(planDayId)] : undefined,
    onMutate: (payload) => ({ ownerId: planDayId, payload }),
    onSuccess: (_data, _variables, context) => {
      if (!context?.ownerId) return;
      setParseFailureState((prev) =>
        prev.ownerId === context.ownerId ? { ownerId: null, retry: null } : prev,
      );
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

  const hasStructuredRows = (exercisesQuery.data?.length ?? 0) > 0;
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
    mutationFn: (patch: { focus?: string; mainWorkout?: string | null; accessory?: string | null; notes?: string | null }) =>
      api.plans.updateDayWithoutPlan(planDayId!, patch),
    invalidateQueries: [QUERY_KEYS.timeline, QUERY_KEYS.plans],
    onSuccess: () => {
      exerciseSetOps.markSaved();
    },
    errorToast: "Couldn't save prescription",
  });

  const exerciseSets = useMemo(() => exercisesQuery.data ?? [], [exercisesQuery.data]);
  const getExerciseSetsWithPendingPatches = useCallback(() => {
    const pendingPatches = getPendingPatches();
    if (pendingPatches.length === 0) return exerciseSets;

    const patchesBySetId = new Map<string, Partial<ExerciseSet>>(
      pendingPatches.map(({ setId, patch }) => [setId, patch]),
    );
    return exerciseSets.map((set) => {
      const patch = patchesBySetId.get(set.id);
      return patch ? ({ ...set, ...patch } as ExerciseSet) : set;
    });
  }, [exerciseSets, getPendingPatches]);

  return {
    exerciseSets,
    getExerciseSetsWithPendingPatches,
    isLoading: exercisesQuery.isLoading,
    isSaving,
    lastSavedAt,
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
  };
}

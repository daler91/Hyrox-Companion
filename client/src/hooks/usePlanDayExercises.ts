import type { ExerciseSet } from "@shared/schema";
import { useIsMutating,useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useApiMutation } from "@/hooks/useApiMutation";
import { type AddExerciseSetPayload, api, type PatchExerciseSetPayload, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

// Tag every plan-day set mutation with this key family so useIsMutating
// can count ALL in-flight writes for the current plan day — not just
// the most recent one. useMutation.isPending only reflects the latest
// mutate() call, which would hide concurrent PATCHes when a row edit
// fans out to multiple set ids.
const planDaySetsMutationKey = (planDayId: string) => ["plan-day-sets", planDayId] as const;

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
  // not.
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
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
    addSet,
    deleteSet,
  };
}

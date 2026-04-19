import type { ExerciseSet } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";

import { useApiMutation } from "@/hooks/useApiMutation";
import { type AddExerciseSetPayload, api, type PatchExerciseSetPayload, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

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

  const updateSet = useApiMutation({
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
    mutationFn: (data: AddExerciseSetPayload) => api.plans.addDayExercise(planDayId!, data),
    onSuccess: (serverSet) => {
      patchCachedSets((sets) => [...sets, serverSet]);
    },
    errorToast: "Couldn't add that exercise",
  });

  const deleteSet = useApiMutation({
    mutationFn: (setId: string) =>
      api.plans.deleteDayExercise(planDayId!, setId).then(() => setId),
    onMutate: async (setId: string) => {
      if (!planDayId) return undefined;
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.planDayExercises(planDayId) });
      const prev = queryClient.getQueryData<ExerciseSet[]>(QUERY_KEYS.planDayExercises(planDayId));
      patchCachedSets((sets) => sets.filter((s) => s.id !== setId));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      const prev = (ctx as { prev?: ExerciseSet[] } | undefined)?.prev;
      if (planDayId && prev) {
        queryClient.setQueryData(QUERY_KEYS.planDayExercises(planDayId), prev);
      }
    },
    errorToast: "Couldn't remove that set",
  });

  // True while any set-level write is in flight. Consumers gate the
  // "Mark complete" CTA on this so we don't fire logWorkoutMutation
  // while a debounced cell save is still posting; otherwise
  // createWorkoutInTx's plan-day copy can race with the PATCH and
  // snapshot pre-edit values.
  const isSaving = updateSet.isPending || addSet.isPending || deleteSet.isPending;

  return {
    exerciseSets: exercisesQuery.data ?? [],
    isLoading: exercisesQuery.isLoading,
    isSaving,
    updateSet,
    addSet,
    deleteSet,
  };
}

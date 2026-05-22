import type { ExerciseSet } from "@shared/schema";
import { useIsMutating } from "@tanstack/react-query";
import { useState } from "react";

import { useApiMutation } from "@/hooks/useApiMutation";
import { useDebouncedSetPatches } from "@/hooks/useDebouncedSetPatches";
import { type AddExerciseSetPayload, type PatchExerciseSetPayload } from "@/lib/api/exerciseSetMutations";
import { queryClient } from "@/lib/queryClient";

type QueryKey = readonly unknown[];

type Params<TSnapshot> = {
  ownerId: string | null;
  mutationKeyFamily: (ownerId: string) => QueryKey;
  setsQueryKey: (ownerId: string) => QueryKey;
  patchCachedSets: (updater: (sets: ExerciseSet[]) => ExerciseSet[]) => void;
  getSnapshot: (ownerId: string) => TSnapshot | undefined;
  restoreSnapshot: (ownerId: string, snapshot: TSnapshot) => void;
  updateSetRequest: (ownerId: string, setId: string, data: PatchExerciseSetPayload) => Promise<ExerciseSet>;
  addSetRequest: (ownerId: string, data: AddExerciseSetPayload) => Promise<ExerciseSet>;
  deleteSetRequest: (ownerId: string, setId: string) => Promise<unknown>;
  addInvalidateQueries?: (ownerId: string) => QueryKey[] | undefined;
  deleteInvalidateQueries?: (ownerId: string) => QueryKey[] | undefined;
  cellSaveDebounceMs?: number;
};

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
  cellSaveDebounceMs = 350,
}: Params<TSnapshot>) {
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [activeOwnerId, setActiveOwnerId] = useState(ownerId);
  const markSaved = () => setLastSavedAt(Date.now());

  const updateSet = useApiMutation({
    mutationKey: ownerId ? mutationKeyFamily(ownerId) : undefined,
    mutationFn: ({ setId, data }: { setId: string; data: PatchExerciseSetPayload }) =>
      updateSetRequest(ownerId!, setId, data),
    onMutate: async ({ setId, data }) => {
      if (!ownerId) return undefined;
      await queryClient.cancelQueries({ queryKey: setsQueryKey(ownerId) });
      const prev = getSnapshot(ownerId);
      patchCachedSets((sets) => sets.map((s) => (s.id === setId ? ({ ...s, ...data }) : s)));
      return { prev };
    },
    onSuccess: (serverSet) => {
      patchCachedSets((sets) => sets.map((s) => (s.id === serverSet.id ? serverSet : s)));
      markSaved();
    },
    onError: (_err, _vars, ctx) => {
      const prev = (ctx as { prev?: TSnapshot } | undefined)?.prev;
      if (ownerId && prev) restoreSnapshot(ownerId, prev);
    },
    errorToast: "Couldn't save that change",
  });

  const { patchSetDebounced, flushPendingSetPatches, cancelPending, getPendingPatches } =
    useDebouncedSetPatches<PatchExerciseSetPayload>(updateSet.mutateAsync, cellSaveDebounceMs);

  if (ownerId !== activeOwnerId) {
    setActiveOwnerId(ownerId);
    setLastSavedAt(null);
    cancelPending();
  }

  const addSet = useApiMutation({
    mutationKey: ownerId ? mutationKeyFamily(ownerId) : undefined,
    mutationFn: (data: AddExerciseSetPayload) => addSetRequest(ownerId!, data),
    onSuccess: (serverSet) => {
      patchCachedSets((sets) => [...sets, serverSet]);
      markSaved();
    },
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
      patchCachedSets((sets) => sets.filter((s) => s.id !== setId));
      return { prev };
    },
    onSuccess: () => markSaved(),
    onError: (_err, _vars, ctx) => {
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
    markSaved,
  };
}

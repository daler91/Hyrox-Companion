import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useCallback } from "react";

import type { PatchExerciseSetPayload } from "@/lib/api";
import type { GroupedExercise } from "@/lib/exerciseUtils";

import { dispatchSortOrderMutations } from "./state";

export function useExerciseDndHandler(
  groups: readonly GroupedExercise[],
  rowKeys: readonly string[],
  onUpdateSet: (setId: string, data: PatchExerciseSetPayload) => void,
) {
  return useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = rowKeys.indexOf(active.id as string);
    const newIndex = rowKeys.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;

    const nextGroups = arrayMove([...groups], oldIndex, newIndex);
    dispatchSortOrderMutations(nextGroups, onUpdateSet);
  }, [groups, rowKeys, onUpdateSet]);
}

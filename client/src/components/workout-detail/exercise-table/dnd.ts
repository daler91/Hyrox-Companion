import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useCallback } from "react";

import type { PatchExerciseSetPayload } from "@/lib/api";
import type { GroupedExercise } from "@/lib/exerciseUtils";

import { dispatchSortOrderMutations, orderedSetIds } from "./state";

/**
 * Drop handler for the exercise table. `onSaveOrder` saves the whole new order
 * in one request where the table persists (PF5, CODEBASE_ANALYSIS_2026-10-03);
 * without it each moved set goes through `onUpdateSet`.
 */
export function useExerciseDndHandler(
  groups: readonly GroupedExercise[],
  rowKeys: readonly string[],
  onUpdateSet: (setId: string, data: PatchExerciseSetPayload) => void,
  onSaveOrder?: (setIds: string[]) => void,
) {
  return useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = rowKeys.indexOf(active.id as string);
    const newIndex = rowKeys.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;

    const nextGroups = arrayMove([...groups], oldIndex, newIndex);
    if (onSaveOrder) onSaveOrder(orderedSetIds(nextGroups));
    else dispatchSortOrderMutations(nextGroups, onUpdateSet);
  }, [groups, rowKeys, onUpdateSet, onSaveOrder]);
}

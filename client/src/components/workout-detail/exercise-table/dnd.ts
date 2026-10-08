import type {
  Announcements,
  DragEndEvent,
  ScreenReaderInstructions,
  UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useCallback, useMemo } from "react";

import type { PatchExerciseSetPayload } from "@/lib/api";
import { getExerciseLabel, type GroupedExercise } from "@/lib/exerciseUtils";

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

export const exerciseDndScreenReaderInstructions: ScreenReaderInstructions = {
  draggable:
    "To reorder an exercise, press space or enter to pick it up, use the up and down arrow keys to move it, then press space or enter to drop it. Press escape to cancel.",
};

/**
 * Screen-reader feedback for keyboard reordering, naming the exercise and its
 * position. dnd-kit's defaults read the opaque row ids, so VoiceOver said
 * "Picked up draggable item 3f2a9c1e-…". Timeline does the same for its
 * cards. U24 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function buildExerciseDndAnnouncements(
  groups: readonly GroupedExercise[],
  rowKeys: readonly string[],
): Announcements {
  const total = String(rowKeys.length);
  const nameOf = (id: UniqueIdentifier): string => {
    const index = rowKeys.indexOf(String(id));
    const group = index < 0 ? undefined : groups.at(index);
    return group ? getExerciseLabel(group.exerciseName, group.customLabel) : "the exercise";
  };
  const positionOf = (id: UniqueIdentifier): string =>
    `position ${String(rowKeys.indexOf(String(id)) + 1)} of ${total}`;

  return {
    onDragStart: ({ active }) =>
      `Picked up ${nameOf(active.id)} at ${positionOf(active.id)}. Use the arrow keys to move it, then press space to drop.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${nameOf(active.id)} is over ${positionOf(over.id)}.`
        : `${nameOf(active.id)} is no longer over the list.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `Dropped ${nameOf(active.id)} at ${positionOf(over.id)}.`
        : `Dropped ${nameOf(active.id)}; it stayed at ${positionOf(active.id)}.`,
    onDragCancel: ({ active }) =>
      `Cancelled. ${nameOf(active.id)} stayed at ${positionOf(active.id)}.`,
  };
}

export function useExerciseDndAnnouncements(
  groups: readonly GroupedExercise[],
  rowKeys: readonly string[],
): Announcements {
  return useMemo(() => buildExerciseDndAnnouncements(groups, rowKeys), [groups, rowKeys]);
}

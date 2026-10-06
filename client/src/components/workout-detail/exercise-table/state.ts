import type { PatchExerciseSetPayload } from "@/lib/api";
import type { GroupedExercise } from "@/lib/exerciseUtils";

export function toggleExerciseRow(expanded: ReadonlySet<string>, rowKey: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(rowKey)) next.delete(rowKey);
  else next.add(rowKey);
  return next;
}

/**
 * The per-set reorder, for a table that saves nothing (a draft): one
 * `sortOrder` update per moved set. A persisted table saves the whole order in
 * one request instead (`orderedSetIds`, PF5).
 */
export function dispatchSortOrderMutations(
  nextGroups: readonly GroupedExercise[],
  onUpdateSet: (setId: string, data: PatchExerciseSetPayload) => void,
) {
  let order = 0;
  for (const g of nextGroups) {
    for (const s of g.sets) {
      if (s.sortOrder !== order) onUpdateSet(s.id, { sortOrder: order });
      order += 1;
    }
  }
}

/** Every set id in display order: the body of the one-request order save (PF5). */
export function orderedSetIds(groups: readonly GroupedExercise[]): string[] {
  return groups.flatMap((group) => group.sets.map((set) => set.id));
}

function isLegacyEmomName(name: string): boolean {
  return name.trim().toLowerCase() === "emom";
}

export function groupsContainLegacyEmom(groups: readonly GroupedExercise[]): boolean {
  return groups.some((group) => isLegacyEmomName(group.exerciseName));
}

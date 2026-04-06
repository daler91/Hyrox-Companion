import { useMemo } from "react";

import type { StructuredExercise } from "@/components/ExerciseInput";

export function useBlockCounts(
  editExercises: string[],
  editExerciseData: Record<string, StructuredExercise>
) {
  return useMemo(() => {
    // ⚡ Bolt Performance Optimization:
    // Combine two O(N) array traversals into a single O(N) traversal
    // and remove the need for a secondary runningCounts object allocation.
    const counts: Record<string, number> = {};
    const indices: Record<string, number> = {};

    for (const blockId of editExercises) {
      const exData = editExerciseData[blockId];
      if (exData?.exerciseName) {
        const name = exData.exerciseName;
        counts[name] = (counts[name] || 0) + 1;
        indices[blockId] = counts[name];
      }
    }

    return { blockCounts: counts, blockIndices: indices };
  }, [editExercises, editExerciseData]);
}

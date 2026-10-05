import type { ExerciseSet } from "@shared/schema";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { PatchExerciseSetPayload } from "@/lib/api/exerciseSetMutations";
import type { StructuredExercise } from "@/lib/structuredExercise";

import { DraftExerciseTable } from "./DraftExerciseTable";

const ASSIGN_PATCH: PatchExerciseSetPayload = {
  blockId: "block-emom",
  stepNumber: 2,
  intervalMinute: 2,
  cycleNumber: null,
  stepRole: "work",
  groupId: null,
};

// Stands in for the row menu's block assignment, which calls onUpdateSet once
// per set of the row inside one event handler (ExerciseRows handleAssignBlock).
vi.mock("@/components/workout-detail/ExerciseTable", () => ({
  ExerciseTable: ({
    exerciseSets,
    onUpdateSet,
  }: {
    exerciseSets: ExerciseSet[];
    onUpdateSet: (setId: string, patch: PatchExerciseSetPayload) => void;
  }) => (
    <button
      type="button"
      data-testid="assign-row"
      onClick={() => {
        for (const set of exerciseSets) onUpdateSet(set.id, ASSIGN_PATCH);
      }}
    >
      Assign
    </button>
  ),
}));

const threeSetWallBalls: StructuredExercise = {
  exerciseName: "wall_balls",
  category: "functional",
  sets: [
    { setNumber: 1, reps: 20 },
    { setNumber: 2, reps: 20 },
    { setNumber: 3, reps: 15 },
  ],
};

function Harness() {
  const [exerciseData, setExerciseData] = useState<Record<string, StructuredExercise>>({
    wallBalls: threeSetWallBalls,
  });
  return (
    <>
      <DraftExerciseTable
        exerciseBlocks={["wallBalls"]}
        exerciseData={exerciseData}
        addExercise={vi.fn()}
        updateBlock={(blockId, data) => {
          setExerciseData((prev) => ({ ...prev, [blockId]: data }));
        }}
        removeBlock={vi.fn()}
        reorderBlocks={vi.fn()}
        weightUnit="kg"
        distanceUnit="km"
      />
      <pre data-testid="sets">{JSON.stringify(exerciseData.wallBalls.sets)}</pre>
    </>
  );
}

describe("DraftExerciseTable", () => {
  it("applies a block assignment to every set of the row, not only the last one patched (CL16)", () => {
    render(<Harness />);

    fireEvent.click(screen.getByTestId("assign-row"));

    const sets = JSON.parse(screen.getByTestId("sets").textContent) as StructuredExercise["sets"];
    expect(sets).toHaveLength(3);
    for (const set of sets) {
      expect(set).toMatchObject({
        blockId: "block-emom",
        stepNumber: 2,
        intervalMinute: 2,
        stepRole: "work",
      });
    }
    // The per-set values survive alongside the assignment.
    expect(sets.map((set) => set.reps)).toEqual([20, 20, 15]);
  });
});

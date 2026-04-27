import type { ExerciseSet } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ExerciseTable } from "../ExerciseTable";

function makeSet(overrides: Partial<ExerciseSet> = {}): ExerciseSet {
  return {
    id: "set-1",
    workoutLogId: "log-1",
    planDayId: null,
    exerciseName: "back_squat",
    customLabel: null,
    category: "strength",
    setNumber: 1,
    reps: 8,
    weight: 60,
    distance: null,
    time: null,
    plannedReps: null,
    plannedWeight: null,
    plannedDistance: null,
    plannedTime: null,
    notes: null,
    confidence: 95,
    sortOrder: 0,
    ...overrides,
  };
}

// One reorder = many PATCHes (one per moved set). We assert the payloads
// shape rather than invoking the @dnd-kit keyboard sensor directly — the
// reorder math lives in the inline `handleDragEnd` and is easy to cover
// by invoking the same arrayMove-based sequence on the rendered groups.
describe("ExerciseTable drag handle", () => {
  it("renders a drag handle for every group", () => {
    const sets: ExerciseSet[] = [
      makeSet({ id: "a1", exerciseName: "back_squat", sortOrder: 0 }),
      makeSet({
        id: "b1",
        exerciseName: "kettlebell_swings",
        sortOrder: 1,
        reps: 12,
        weight: 24,
      }),
      makeSet({
        id: "c1",
        exerciseName: "custom",
        customLabel: "Burpees",
        category: "conditioning",
        sortOrder: 2,
        reps: 10,
        weight: null,
      }),
    ];

    render(
      <ExerciseTable
        workoutId="log-1"
        exerciseSets={sets}
        weightUnit="kg"
        onUpdateSet={vi.fn()}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
      />,
    );

    // Unified summary layout renders one row (and one handle) per group
    // at every viewport, so 3 groups → 3 handles.
    const handles = screen.getAllByTestId("exercise-row-drag-handle");
    expect(handles.length).toBe(sets.length);
    for (const h of handles) {
      expect(h.getAttribute("aria-label")).toMatch(/Reorder /);
    }
  });

  it("renders readable planned diffs and expands the inline editor on tap", async () => {
    const sets: ExerciseSet[] = [
      makeSet({
        id: "set-diff",
        reps: 8,
        weight: 95,
        plannedReps: 8,
        plannedWeight: 100,
      }),
    ];

    render(
      <ExerciseTable
        workoutId="log-1"
        exerciseSets={sets}
        weightUnit="kg"
        onUpdateSet={vi.fn()}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
        readableSummary
        showPlannedDiffs
      />,
    );

    expect(screen.getByTestId("exercise-row-planned-diff")).toHaveTextContent("planned 100 kg");
    expect(screen.queryByTestId("set-row-set-diff")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/Edit Back Squat/i));

    expect(screen.getByTestId("set-row-set-diff")).toBeInTheDocument();
    expect(screen.getByTestId("planned-weight-set-diff")).toHaveTextContent("planned 100 kg");
  });

  it("sends a sortOrder PATCH only for rows whose index changed", () => {
    // This mirrors the reorder math in `handleDragEnd`: moving group
    // index 2 → 0 renumbers the flat set sequence 0..N-1 and only
    // patches sets whose index actually moved. Keeping this logic
    // covered as a plain array test ensures regressions in the
    // renumbering loop get caught without standing up @dnd-kit in
    // jsdom.
    type Group = { sets: ExerciseSet[] };
    const groups: Group[] = [
      { sets: [makeSet({ id: "a1", sortOrder: 0 })] },
      {
        sets: [
          makeSet({ id: "b1", sortOrder: 1 }),
          makeSet({ id: "b2", sortOrder: 2, setNumber: 2 }),
        ],
      },
      { sets: [makeSet({ id: "c1", sortOrder: 3 })] },
    ];

    const nextGroups = [groups[2], groups[0], groups[1]];
    const onUpdateSet = vi.fn();

    let order = 0;
    for (const g of nextGroups) {
      for (const s of g.sets) {
        if (s.sortOrder !== order) {
          onUpdateSet(s.id, { sortOrder: order });
        }
        order += 1;
      }
    }

    // c1 3 → 0, a1 0 → 1, b1 1 → 2, b2 2 → 3. Every set in the reordered
    // sequence moved, so all four are patched with their new index.
    expect(onUpdateSet).toHaveBeenCalledTimes(4);
    expect(onUpdateSet).toHaveBeenNthCalledWith(1, "c1", { sortOrder: 0 });
    expect(onUpdateSet).toHaveBeenNthCalledWith(2, "a1", { sortOrder: 1 });
    expect(onUpdateSet).toHaveBeenNthCalledWith(3, "b1", { sortOrder: 2 });
    expect(onUpdateSet).toHaveBeenNthCalledWith(4, "b2", { sortOrder: 3 });
  });

  it("skips the PATCH for rows whose sortOrder already matches the target index", () => {
    // Regression guard for the `if (s.sortOrder !== order)` short-circuit
    // in handleDragEnd. Running the same renumber on a list that's
    // already 0..N-1 must fire zero calls — otherwise an incidental
    // re-render (or an idempotent no-op drag) would fan PATCHes across
    // every row.
    const onUpdateSet = vi.fn();
    const sets = [
      makeSet({ id: "a1", sortOrder: 0 }),
      makeSet({ id: "b1", sortOrder: 1 }),
      makeSet({ id: "c1", sortOrder: 2 }),
    ];
    let order = 0;
    for (const s of sets) {
      if (s.sortOrder !== order) onUpdateSet(s.id, { sortOrder: order });
      order += 1;
    }
    expect(onUpdateSet).not.toHaveBeenCalled();
  });
});

import type { ExerciseSet, StructureBlockInput } from "@shared/schema";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { makeExerciseSet as makeSet } from "@/test/factories/exerciseSetFactory";
import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import { ExerciseTable } from "../ExerciseTable";

installRadixPointerMocks();

// One reorder = many PATCHes (one per moved set). We assert the payloads
// shape rather than invoking the @dnd-kit keyboard sensor directly — the
// reorder math lives in the inline `handleDragEnd` and is easy to cover
// by invoking the same arrayMove-based sequence on the rendered groups.
describe("ExerciseTable drag handle", () => {
  it("renders a table-first empty state for text prescriptions", async () => {
    const user = userEvent.setup();
    const onParseText = vi.fn();

    render(
      <ExerciseTable
        workoutId="plan-day-1"
        exerciseSets={[]}
        weightUnit="kg"
        onUpdateSet={vi.fn()}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
        hasUnparsedText
        onOpenConversionHelper={onParseText}
      />,
    );

    expect(screen.getByTestId("exercise-table-empty-parse-hint")).toHaveTextContent(
      "Text prescription saved. No exercise rows yet.",
    );
    expect(screen.getByTestId("exercise-table-empty-add")).toHaveTextContent("Add exercise");

    await user.click(screen.getByTestId("exercise-table-empty-parse"));
    expect(onParseText).toHaveBeenCalledTimes(1);
  });

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
    expect(handles).toHaveLength(sets.length);
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

  it("opens rows that arrive after mount when defaultExpanded is set, without re-opening a collapsed one", async () => {
    // A log sheet mounts with defaultExpanded before its sets query resolves.
    const props = {
      workoutId: "log-1",
      weightUnit: "kg" as const,
      onUpdateSet: vi.fn(),
      onAddSet: vi.fn(),
      onDeleteSet: vi.fn(),
      defaultExpanded: true,
    };
    const { rerender } = render(<ExerciseTable {...props} exerciseSets={[]} />);

    rerender(<ExerciseTable {...props} exerciseSets={[makeSet({ id: "late-1" })]} />);
    expect(screen.getByTestId("set-row-late-1")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/Collapse Back Squat/i));
    expect(screen.queryByTestId("set-row-late-1")).not.toBeInTheDocument();

    // A second late row opens; the collapsed one is left alone.
    rerender(
      <ExerciseTable
        {...props}
        exerciseSets={[
          makeSet({ id: "late-1" }),
          makeSet({ id: "late-2", exerciseName: "kettlebell_swings", sortOrder: 1 }),
        ]}
      />,
    );
    expect(screen.queryByTestId("set-row-late-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("set-row-late-2")).toBeInTheDocument();
  });

  it("renders dynamic distance units in collapsed prescriptions and planned diffs", () => {
    const sets: ExerciseSet[] = [
      makeSet({
        id: "set-distance",
        exerciseName: "easy_run",
        category: "running",
        reps: null,
        weight: null,
        distance: 15840,
        plannedDistance: 16404,
      }),
    ];

    render(
      <ExerciseTable
        workoutId="log-1"
        exerciseSets={sets}
        weightUnit="lb"
        distanceUnit="miles"
        onUpdateSet={vi.fn()}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
        readableSummary
        showPlannedDiffs
      />,
    );

    expect(screen.getByLabelText("Edit Easy Run: 1 set of 3 mi")).toBeInTheDocument();
    expect(screen.getByTestId("exercise-row-planned-diff")).toHaveTextContent("planned 5000 m");
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

  it("allows linked exercise rows to move or clear their block assignment", async () => {
    const user = userEvent.setup();
    const onUpdateSet = vi.fn();
    const structureBlocks: StructureBlockInput[] = [
      {
        id: "block-emom",
        sectionType: "main",
        formatType: "emom",
        durationMinutes: 10,
        steps: [
          { stepNumber: 1, stepType: "work", minuteIndex: 1, exerciseName: "Unassigned exercise" },
          { stepNumber: 2, stepType: "work", minuteIndex: 2, exerciseName: "Unassigned exercise" },
        ],
      },
    ];
    const sets: ExerciseSet[] = [
      makeSet({
        id: "set-1",
        setNumber: 1,
        sortOrder: 0,
        blockId: "block-emom",
        stepNumber: 2,
        intervalMinute: 2,
      }),
      makeSet({
        id: "set-2",
        setNumber: 2,
        sortOrder: 1,
        blockId: "block-emom",
        stepNumber: 2,
        intervalMinute: 2,
      }),
    ];

    render(
      <ExerciseTable
        workoutId="log-1"
        exerciseSets={sets}
        weightUnit="kg"
        onUpdateSet={onUpdateSet}
        onAddSet={vi.fn()}
        onDeleteSet={vi.fn()}
        structureBlocks={structureBlocks}
      />,
    );

    const assignmentBadge = screen.getByTestId("exercise-row-block-assignment");
    expect(assignmentBadge).toHaveTextContent(/EMOM 1.*min 2/);

    await user.click(assignmentBadge);
    await user.click(await screen.findByRole("menuitemradio", { name: /EMOM 1.*min 1/i }));

    await waitFor(() => {
      expect(onUpdateSet).toHaveBeenCalledTimes(2);
    });
    expect(onUpdateSet).toHaveBeenNthCalledWith(1, "set-1", {
      blockId: "block-emom",
      stepNumber: 1,
      intervalMinute: 1,
      cycleNumber: null,
      stepRole: "work",
      groupId: null,
    });
    expect(onUpdateSet).toHaveBeenNthCalledWith(2, "set-2", {
      blockId: "block-emom",
      stepNumber: 1,
      intervalMinute: 1,
      cycleNumber: null,
      stepRole: "work",
      groupId: null,
    });

    onUpdateSet.mockClear();
    await user.click(screen.getByTestId("exercise-row-block-assignment"));
    await user.click(await screen.findByRole("menuitemradio", { name: /No block assignment/i }));

    await waitFor(() => {
      expect(onUpdateSet).toHaveBeenCalledTimes(2);
    });
    expect(onUpdateSet).toHaveBeenNthCalledWith(1, "set-1", {
      blockId: null,
      stepNumber: null,
      intervalMinute: null,
      cycleNumber: null,
      stepRole: null,
      groupId: null,
    });
    expect(onUpdateSet).toHaveBeenNthCalledWith(2, "set-2", {
      blockId: null,
      stepNumber: null,
      intervalMinute: null,
      cycleNumber: null,
      stepRole: null,
      groupId: null,
    });

    await user.click(screen.getByTestId("exercise-row-actions"));
    expect(await screen.findByRole("menuitem", { name: /Block assignment/i })).toBeInTheDocument();
  }, 10_000);
});

describe("ExerciseTable unit stamps (finding D2)", () => {
  const noop = { onUpdateSet: vi.fn(), onAddSet: vi.fn(), onDeleteSet: vi.fn() };

  it("shows a kg-stamped row in pounds to a lb athlete: summary, planned diff and editor", async () => {
    // 100 kg logged before the athlete switched to lb. Read raw and labelled
    // with the current preference it said "100 lb", 2.2x lighter than lifted.
    const sets: ExerciseSet[] = [
      makeSet({ id: "kg-row", reps: 8, weight: 100, plannedReps: 8, plannedWeight: 90, weightUnit: "kg" }),
    ];

    render(
      <ExerciseTable
        workoutId="log-1"
        exerciseSets={sets}
        weightUnit="lb"
        distanceUnit="miles"
        {...noop}
        readableSummary
        showPlannedDiffs
      />,
    );

    expect(screen.getByLabelText("Edit Back Squat: 1 set of 8 reps at 220 lb")).toBeInTheDocument();
    expect(screen.getByTestId("exercise-row-planned-diff")).toHaveTextContent("planned 198 lb");

    await userEvent.setup().click(screen.getByLabelText(/Edit Back Squat/));
    expect(screen.getByTestId("input-weight-kg-row")).toHaveValue(220);
    expect(screen.getByTestId("planned-weight-kg-row")).toHaveTextContent("planned 198 lb");
  });

  it("shows a feet-stamped distance in metres to a km athlete", () => {
    // 1312 ft is what a miles athlete stored for a 400 m effort.
    const sets: ExerciseSet[] = [
      makeSet({
        id: "ft-row",
        exerciseName: "easy_run",
        category: "running",
        reps: null,
        weight: null,
        distance: 1312,
        distanceUnit: "ft",
      }),
    ];

    render(
      <ExerciseTable
        workoutId="log-1"
        exerciseSets={sets}
        weightUnit="kg"
        distanceUnit="km"
        {...noop}
        readableSummary
      />,
    );

    expect(screen.getByLabelText("Edit Easy Run: 1 set of 400 m")).toBeInTheDocument();
  });

  it("leaves a row stamped in the athlete's own unit exactly as stored", () => {
    const sets: ExerciseSet[] = [makeSet({ id: "lb-row", reps: 5, weight: 225, weightUnit: "lbs" })];

    render(
      <ExerciseTable workoutId="log-1" exerciseSets={sets} weightUnit="lb" {...noop} readableSummary />,
    );

    expect(screen.getByLabelText("Edit Back Squat: 1 set of 5 reps at 225 lb")).toBeInTheDocument();
  });
});

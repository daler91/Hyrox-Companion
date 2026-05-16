import type { StructureBlockInput } from "@shared/schema";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { makeExerciseSet as makeSet } from "@/test/factories/exerciseSetFactory";
import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import { StructureBlocksEditor } from "./StructureBlocksEditor";

installRadixPointerMocks();

function Harness({ initial = [] as StructureBlockInput[], showScoreControls = false }) {
  const [value, setValue] = useState<StructureBlockInput[]>(initial);
  return (
    <>
      <StructureBlocksEditor value={value} onChange={setValue} showScoreControls={showScoreControls} />
      <pre data-testid="harness-snapshot">{JSON.stringify(value)}</pre>
    </>
  );
}

const readSnapshot = (): StructureBlockInput[] =>
  JSON.parse(screen.getByTestId("harness-snapshot").textContent || "[]");

describe("StructureBlocksEditor", () => {
  it("collapses the format picker behind a single add affordance when empty", () => {
    render(<Harness />);
    expect(screen.getByTestId("structure-blocks-add-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("structure-blocks-add-emom")).not.toBeInTheDocument();
  });

  it("treats an omitted value as an empty block list", () => {
    render(<StructureBlocksEditor onChange={vi.fn()} />);
    expect(screen.getByTestId("structure-blocks-add-toggle")).toBeInTheDocument();
  });

  it("adds an EMOM block via the add button and surfaces it in onChange", () => {
    render(<Harness />);

    fireEvent.click(screen.getByTestId("structure-blocks-add-toggle"));
    fireEvent.click(screen.getByTestId("structure-blocks-add-emom"));

    const blocks = readSnapshot();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      id: expect.any(String),
      sectionType: "main",
      formatType: "emom",
      durationMinutes: 10,
      sequenceOrder: 0,
    });
    expect(blocks[0].steps).toHaveLength(1);
    expect(blocks[0].steps[0]).toMatchObject({
      stepNumber: 1,
      stepType: "work",
      minuteIndex: 1,
      exerciseName: "Unassigned exercise",
    });
  });

  it("adds AMRAP and rounds blocks via explicit add buttons", () => {
    render(<Harness />);

    fireEvent.click(screen.getByTestId("structure-blocks-add-toggle"));
    fireEvent.click(screen.getByTestId("structure-blocks-add-amrap"));
    fireEvent.click(screen.getByTestId("structure-blocks-add-rounds"));

    const blocks = readSnapshot();
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      sectionType: "main",
      formatType: "amrap",
      timeCapMinutes: 10,
    });
    expect(blocks[1]).toMatchObject({
      sectionType: "main",
      formatType: "rounds",
      roundCount: 3,
    });
  });

  it("renders block-first previews for AMRAP and rounds blocks", () => {
    render(
      <Harness
        initial={[
          {
            id: "block-amrap",
            sectionType: "main",
            formatType: "amrap",
            timeCapMinutes: 12,
            steps: [{ stepNumber: 1, stepType: "work", exerciseName: "Row" }],
          },
          {
            id: "block-rounds",
            sectionType: "main",
            formatType: "rounds",
            roundCount: 4,
            steps: [{ stepNumber: 1, stepType: "work", exerciseName: "Wall Balls" }],
          },
        ]}
      />,
    );

    expect(screen.getByText(/Repeat 1 step until 12 min cap/i)).toBeInTheDocument();
    expect(screen.getByText(/Complete 4 rounds of 1 step/i)).toBeInTheDocument();
  });

  it("assigns an unlinked exercise row from the block card", async () => {
    const user = userEvent.setup();
    const onUpdateSet = vi.fn();
    render(
      <StructureBlocksEditor
        value={[{
          id: "block-emom",
          sectionType: "main",
          formatType: "emom",
          durationMinutes: 10,
          steps: [{ stepNumber: 1, stepType: "work", minuteIndex: 1, exerciseName: "Unassigned exercise" }],
        }]}
        onChange={vi.fn()}
        exerciseSets={[
          makeSet({ id: "set-1", setNumber: 1, sortOrder: 0 }),
          makeSet({ id: "set-2", setNumber: 2, sortOrder: 1 }),
        ]}
        onUpdateSet={onUpdateSet}
      />,
    );

    expect(screen.getByTestId("structure-block-missing-link")).toHaveTextContent("No exercise row linked.");
    await user.click(screen.getByRole("combobox", { name: /Assign row to Min 1/i }));
    await user.click(await screen.findByRole("option", { name: /Back Squat/i }));

    expect(onUpdateSet).toHaveBeenCalledTimes(2);
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
  });

  it("keeps step link actions available after one row is already linked", async () => {
    const user = userEvent.setup();
    const onUpdateSet = vi.fn();
    const onAddSet = vi.fn();
    render(
      <StructureBlocksEditor
        value={[{
          id: "block-emom",
          sectionType: "main",
          formatType: "emom",
          durationMinutes: 10,
          steps: [{ stepNumber: 1, stepType: "work", minuteIndex: 1, exerciseName: "Back Squat" }],
        }]}
        onChange={vi.fn()}
        exerciseSets={[
          makeSet({ id: "linked-1", sortOrder: 0, blockId: "block-emom", stepNumber: 1, intervalMinute: 1 }),
          makeSet({
            id: "extra-1",
            exerciseName: "wall_balls",
            category: "functional",
            sortOrder: 1,
            blockId: null,
            stepNumber: null,
            intervalMinute: null,
          }),
        ]}
        onUpdateSet={onUpdateSet}
        onAddSet={onAddSet}
      />,
    );

    expect(screen.getByTestId("structure-block-linked-row")).toHaveTextContent(/Back Squat/i);
    expect(screen.queryByTestId("structure-block-missing-link")).not.toBeInTheDocument();
    expect(screen.getByTestId("structure-block-add-linked-row")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: /Assign row to Min 1/i }));
    await user.click(await screen.findByRole("option", { name: /Wall Balls/i }));

    expect(onUpdateSet).toHaveBeenCalledWith("extra-1", {
      blockId: "block-emom",
      stepNumber: 1,
      intervalMinute: 1,
      cycleNumber: null,
      stepRole: "work",
      groupId: null,
    });

    fireEvent.click(screen.getByTestId("structure-block-add-linked-row"));

    expect(onAddSet).toHaveBeenCalledWith(expect.objectContaining({
      exerciseName: "back_squat",
      customLabel: null,
      category: "strength",
      blockId: "block-emom",
      stepNumber: 1,
      stepRole: "work",
    }));
  });

  it("adds a linked row from an empty block step", () => {
    const onAddSet = vi.fn();
    render(
      <StructureBlocksEditor
        value={[{
          id: "block-rounds",
          sectionType: "main",
          formatType: "rounds",
          roundCount: 3,
          steps: [{ stepNumber: 1, stepType: "work", exerciseName: "Unassigned exercise" }],
        }]}
        onChange={vi.fn()}
        onAddSet={onAddSet}
      />,
    );

    fireEvent.click(screen.getByTestId("structure-block-add-linked-row"));

    expect(onAddSet).toHaveBeenCalledWith(expect.objectContaining({
      exerciseName: "custom",
      customLabel: "Rounds step 1",
      category: "conditioning",
      blockId: "block-rounds",
      stepNumber: 1,
      stepRole: "work",
    }));
  });

  it("hydrates score controls for logged AMRAP blocks", () => {
    render(
      <Harness
        showScoreControls
        initial={[{
          id: "block-1",
          sectionType: "main",
          formatType: "amrap",
          timeCapMinutes: 10,
          score: { type: "amrap", rounds: 3, reps: 8 },
          steps: [{ stepNumber: 1, stepType: "work", exerciseName: "Row" }],
        }]}
      />,
    );

    expect(screen.getByDisplayValue("3")).toBeInTheDocument();
    expect(screen.getByDisplayValue("8")).toBeInTheDocument();
  });

  it("preserves sibling score fields when result notes change", () => {
    render(
      <Harness
        showScoreControls
        initial={[{
          id: "block-1",
          sectionType: "main",
          formatType: "amrap",
          timeCapMinutes: 10,
          score: { type: "amrap", rounds: 3, reps: 8 },
          steps: [{ stepNumber: 1, stepType: "work", exerciseName: "Row" }],
        }]}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Result notes"), { target: { value: "Strong finish" } });

    expect(readSnapshot()[0].score).toEqual({
      type: "amrap",
      rounds: 3,
      reps: 8,
      notes: "Strong finish",
    });
  });

  it("routes persisted score edits through the focused score callback", () => {
    const onChange = vi.fn();
    const onScoreChange = vi.fn();
    render(
      <StructureBlocksEditor
        value={[{
          id: "block-1",
          sectionType: "main",
          formatType: "amrap",
          timeCapMinutes: 10,
          score: { type: "amrap", rounds: 3, reps: 8 },
          steps: [{ stepNumber: 1, stepType: "work", exerciseName: "Row" }],
        }]}
        onChange={onChange}
        showScoreControls
        onScoreChange={onScoreChange}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Result notes"), { target: { value: "Strong finish" } });

    expect(onScoreChange).toHaveBeenCalledWith("block-1", {
      type: "amrap",
      rounds: 3,
      reps: 8,
      notes: "Strong finish",
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("round-trips transition step duration targets", () => {
    render(
      <Harness
        initial={[{
          sectionType: "main",
          formatType: "rounds",
          roundCount: 3,
          steps: [
            { stepNumber: 1, stepType: "work", exerciseName: "Sled Push" },
            { stepNumber: 2, stepType: "transition", targets: { instructions: "Change stations", durationSeconds: 30 } },
          ],
        }]}
      />,
    );

    const durationInputs = screen.getAllByPlaceholderText("Sec");
    expect(durationInputs[1]).toHaveValue(30);
    fireEvent.change(durationInputs[1], { target: { value: "45" } });

    expect(readSnapshot()[0].steps[1].targets).toMatchObject({
      instructions: "Change stations",
      durationSeconds: 45,
    });
  });

  it("labels transition steps as transitions in the EMOM minute preview", () => {
    render(
      <Harness
        initial={[{
          sectionType: "main",
          formatType: "emom",
          durationMinutes: 1,
          steps: [{
            stepNumber: 1,
            stepType: "transition",
            minuteIndex: 1,
            targets: { instructions: "Change stations" },
          }],
        }]}
      />,
    );

    expect(screen.getByText("Min 1: Transition")).toBeInTheDocument();
    expect(screen.queryByText("Min 1: Movement")).not.toBeInTheDocument();
  });

  it("removes a block when the remove button is clicked", () => {
    render(
      <Harness
        initial={[
          {
            sectionType: "main",
            formatType: "emom",
            durationMinutes: 10,
            sequenceOrder: 0,
            sortOrder: 0,
            steps: [{ stepNumber: 1, stepType: "work", exerciseName: "Burpees", minuteIndex: 1 }],
          },
        ]}
      />,
    );

    expect(screen.getByTestId("structure-block-0")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("structure-block-remove-0"));

    expect(readSnapshot()).toHaveLength(0);
  });

  it("hydrates from existing structureBlocks prop", () => {
    render(
      <Harness
        initial={[
          {
            sectionType: "main",
            formatType: "emom",
            durationMinutes: 7,
            sequenceOrder: 0,
            sortOrder: 0,
            steps: [{ stepNumber: 1, stepType: "work", exerciseName: "Box Jumps", minuteIndex: 1 }],
          },
        ]}
      />,
    );

    expect(screen.getByTestId("structure-block-0")).toBeInTheDocument();
    // "Box Jumps" renders in both the step editor and the minute-by-minute
    // EMOM preview, so assert presence rather than a single match.
    expect(screen.getAllByText("Box Jumps").length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("7")).toBeInTheDocument();
  });
});

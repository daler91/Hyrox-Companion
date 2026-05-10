import type { StructureBlockInput } from "@shared/schema";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { StructureBlocksEditor } from "./StructureBlocksEditor";

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
  it("renders an empty-state hint when no blocks exist", () => {
    render(<Harness />);
    expect(screen.getByText(/No structured blocks yet/i)).toBeInTheDocument();
  });

  it("treats an omitted value as an empty block list", () => {
    render(<StructureBlocksEditor onChange={vi.fn()} />);
    expect(screen.getByText(/No structured blocks yet/i)).toBeInTheDocument();
  });

  it("adds an EMOM block via the add button and surfaces it in onChange", () => {
    render(<Harness />);

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
    expect(screen.getByText("Box Jumps")).toBeInTheDocument();
    expect(screen.getByDisplayValue("7")).toBeInTheDocument();
  });
});

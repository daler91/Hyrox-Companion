import type { StructureBlockInput } from "@shared/schema";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { StructureBlocksEditor } from "./StructureBlocksEditor";

function Harness({ initial = [] as StructureBlockInput[] }) {
  const [value, setValue] = useState<StructureBlockInput[]>(initial);
  return (
    <>
      <StructureBlocksEditor value={value} onChange={setValue} />
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

  it("adds an EMOM block via the add button and surfaces it in onChange", () => {
    render(<Harness />);

    fireEvent.click(screen.getByTestId("structure-blocks-add-emom"));

    const blocks = readSnapshot();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      sectionType: "main",
      formatType: "emom",
      durationMinutes: 10,
      sequenceOrder: 0,
    });
    expect(blocks[0].steps).toHaveLength(1);
    expect(blocks[0].steps[0]).toMatchObject({ stepNumber: 1, stepType: "work", minuteIndex: 1 });
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
    expect(screen.getByDisplayValue("Box Jumps")).toBeInTheDocument();
    expect(screen.getByDisplayValue("7")).toBeInTheDocument();
  });
});

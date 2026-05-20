import type { StructureBlockInput } from "@shared/schema";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { StructuredExercise } from "@/components/ExerciseInput";

import { ConfirmStep } from "./ConfirmStep";

vi.mock("@/components/workout/DraftExerciseTable", () => ({
  DraftExerciseTable: () => <div data-testid="draft-exercise-table" />,
}));

vi.mock("@/components/workout-structure", () => ({
  StructureBlocksEditor: () => <div data-testid="structure-blocks-editor" />,
}));

function renderConfirmStep(overrides: Partial<Parameters<typeof ConfirmStep>[0]> = {}) {
  const updateBlock = vi.fn();
  const setStructureBlocks = vi.fn();
  const emomExercise = {
    exerciseName: "emom",
    customLabel: null,
    category: "conditioning",
    confidence: 80,
    sets: [],
  } as unknown as StructuredExercise;

  const props = {
    freeText: "",
    exerciseBlocks: ["emom-row"],
    exerciseData: { "emom-row": emomExercise },
    addExercise: vi.fn(),
    updateBlock,
    removeBlock: vi.fn(),
    reorderBlocks: vi.fn(),
    weightUnit: "kg" as const,
    distanceUnit: "km" as const,
    autoParsing: false,
    parseDiagnostics: {
      lowConfidenceCount: 0,
      emptyResult: false,
      lastErrorReason: null,
      lastConfidenceSummary: null,
    },
    cancelAutoParse: vi.fn(),
    structureBlocks: [] as StructureBlockInput[],
    setStructureBlocks,
    onBack: vi.fn(),
    onContinue: vi.fn(),
    ...overrides,
  };

  render(<ConfirmStep {...props} />);
  return { updateBlock, setStructureBlocks };
}

describe("ConfirmStep", () => {
  it("renders the legacy EMOM warning in amber and converts with design-system labeled inputs", async () => {
    const { updateBlock, setStructureBlocks } = renderConfirmStep();
    const warning = screen.getByTestId("confirm-step-legacy-emom-warning");

    expect(warning).toHaveClass("border-amber-500/40", "bg-amber-500/5", "text-amber-700");

    const durationInput = screen.getByLabelText("Duration (min)");
    const stepLabelInput = screen.getByLabelText("Step label");
    fireEvent.change(durationInput, { target: { value: "14" } });
    await userEvent.clear(stepLabelInput);
    await userEvent.type(stepLabelInput, "Burpees");
    await userEvent.click(screen.getByRole("button", { name: "Convert to EMOM block" }));

    expect(setStructureBlocks).toHaveBeenCalledWith([
      expect.objectContaining({
        formatType: "emom",
        durationMinutes: 14,
        steps: [expect.objectContaining({ exerciseName: "Burpees" })],
      }),
    ]);
    expect(updateBlock).toHaveBeenCalledWith(
      "emom-row",
      expect.objectContaining({
        exerciseName: "custom",
        customLabel: "EMOM",
      }),
    );
  });
});

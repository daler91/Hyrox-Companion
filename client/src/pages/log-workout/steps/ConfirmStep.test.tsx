import type { StructureBlockInput } from "@shared/schema";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { StepLinkMove } from "@/components/workout-structure";
import type { StructuredExercise } from "@/lib/structuredExercise";

import { ConfirmStep } from "./ConfirmStep";

vi.mock("@/components/workout/DraftExerciseTable", () => ({
  DraftExerciseTable: () => <div data-testid="draft-exercise-table" />,
}));

const structureEditorProps = vi.hoisted(() => ({
  onChange: undefined as
    ((next: StructureBlockInput[], moves: readonly StepLinkMove[]) => unknown) | undefined,
}));

vi.mock("@/components/workout-structure", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/workout-structure")>()),
  StructureBlocksEditor: ({
    onChange,
  }: {
    onChange: (next: StructureBlockInput[], moves: readonly StepLinkMove[]) => unknown;
  }) => {
    structureEditorProps.onChange = onChange;
    return <div data-testid="structure-blocks-editor" />;
  },
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

  it("moves the draft rows with their step when a structure step is removed (CL15)", () => {
    const linked = (stepNumber: number): StructuredExercise["sets"][number] => ({
      setNumber: 1,
      blockId: "block-emom",
      stepNumber,
      intervalMinute: stepNumber,
      stepRole: "work",
    });
    const wallBalls: StructuredExercise = {
      exerciseName: "wall_balls",
      category: "functional",
      sets: [linked(1)],
    };
    const burpees: StructuredExercise = {
      exerciseName: "burpees",
      category: "conditioning",
      sets: [linked(2)],
    };
    const row: StructuredExercise = {
      exerciseName: "rowing",
      category: "conditioning",
      sets: [linked(3)],
    };
    const { updateBlock, setStructureBlocks } = renderConfirmStep({
      exerciseBlocks: ["wall", "burpees", "row"],
      exerciseData: { wall: wallBalls, burpees, row },
    });
    const next: StructureBlockInput[] = [
      {
        id: "block-emom",
        sectionType: "main",
        formatType: "emom",
        durationMinutes: 8,
        steps: [
          { stepNumber: 1, minuteIndex: 1, stepType: "work", exerciseName: "burpees" },
          { stepNumber: 2, minuteIndex: 2, stepType: "work", exerciseName: "row" },
        ],
      },
    ];

    act(() => {
      structureEditorProps.onChange?.(next, [
        {
          blockId: "block-emom",
          fromStepNumber: 1,
          toStepNumber: null,
          fromMinuteIndex: 1,
          toMinuteIndex: null,
        },
        {
          blockId: "block-emom",
          fromStepNumber: 2,
          toStepNumber: 1,
          fromMinuteIndex: 2,
          toMinuteIndex: 1,
        },
        {
          blockId: "block-emom",
          fromStepNumber: 3,
          toStepNumber: 2,
          fromMinuteIndex: 3,
          toMinuteIndex: 2,
        },
      ]);
    });

    expect(updateBlock).toHaveBeenCalledWith(
      "wall",
      expect.objectContaining({
        sets: [expect.objectContaining({ blockId: null, stepNumber: null })],
      }),
    );
    expect(updateBlock).toHaveBeenCalledWith(
      "burpees",
      expect.objectContaining({
        sets: [
          expect.objectContaining({ blockId: "block-emom", stepNumber: 1, intervalMinute: 1 }),
        ],
      }),
    );
    expect(updateBlock).toHaveBeenCalledWith(
      "row",
      expect.objectContaining({
        sets: [
          expect.objectContaining({
            blockId: "block-emom",
            stepNumber: 2,
            intervalMinute: 2,
            stepRole: "work",
          }),
        ],
      }),
    );
    expect(setStructureBlocks).toHaveBeenCalledWith(next);
  });
});

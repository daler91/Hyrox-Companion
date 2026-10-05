import type { StructureBlockInput, TimelineEntry } from "@shared/schema";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, type Ref, useEffect, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StepLinkMove, StructureBlocksEditorHandle } from "@/components/workout-structure";

import { LogSheet } from "../LogSheet";

type ChangeHandler = (next: StructureBlockInput[], moves: readonly StepLinkMove[]) => unknown;

const mocks = vi.hoisted(() => ({
  usePlanDayExercises: vi.fn<(planDayId: string | null) => unknown>(),
  flags: { emomBuilderEnabled: false, nutritionEnabled: false },
  editor: {
    onChange: undefined as ChangeHandler | undefined,
    saveDebounceMs: undefined as number | undefined,
    flush: vi.fn<() => Promise<boolean>>(),
  },
}));

vi.mock("@/lib/featureFlags", () => ({ featureFlags: mocks.flags }));

vi.mock("@/hooks/usePlanDayExercises", () => ({
  usePlanDayExercises: (planDayId: string | null) => mocks.usePlanDayExercises(planDayId),
}));

vi.mock("@/hooks/useExerciseHistory", () => ({
  useExerciseHistory: () => ({ data: undefined }),
}));

vi.mock("@/hooks/useUnitPreferences", () => ({
  useUnitPreferences: () => ({ weightUnit: "kg", distanceUnit: "m" }),
}));

vi.mock("@/components/ui/responsive-sheet", () => ({
  ResponsiveSheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// Records what the sheet wires into the builder; the builder's own save timing
// is covered by its own specs.
function EditorDouble({
  ref,
  onChange,
  saveDebounceMs,
}: {
  ref?: Ref<StructureBlocksEditorHandle>;
  onChange: ChangeHandler;
  saveDebounceMs?: number;
}) {
  useEffect(() => {
    mocks.editor.onChange = onChange;
    mocks.editor.saveDebounceMs = saveDebounceMs;
  });
  useImperativeHandle(ref, () => ({ flush: mocks.editor.flush }), []);
  return <div data-testid="structure-blocks-editor" />;
}

vi.mock("@/components/workout-structure", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/workout-structure")>()),
  StructureBlocksEditor: EditorDouble,
}));

const entry = {
  id: "entry-1",
  date: "2026-05-05",
  focus: "Engine",
  status: "planned",
  planDayId: "plan-day-1",
  mainWorkout: "EMOM 9",
  accessory: null,
  notes: null,
  rpe: null,
} as unknown as TimelineEntry;

const emomBlock: StructureBlockInput = {
  id: "block-emom",
  sectionType: "main",
  formatType: "emom",
  durationMinutes: 8,
  steps: [
    { stepNumber: 1, minuteIndex: 1, stepType: "work", exerciseName: "burpees", stepRole: "work" },
    { stepNumber: 2, minuteIndex: 2, stepType: "work", exerciseName: "row", stepRole: "work" },
  ],
};

function planDayState(overrides: Record<string, unknown> = {}) {
  return {
    exerciseSets: [],
    parseFailed: false,
    retryParse: null,
    isSaving: false,
    lastSavedAt: null,
    structureBlocks: [],
    flushPendingSetPatches: vi.fn(() => Promise.resolve()),
    patchSetDebounced: vi.fn(),
    updateSet: { mutateAsync: vi.fn(() => Promise.resolve()) },
    addSet: { mutate: vi.fn() },
    deleteSet: { mutate: vi.fn() },
    reparseFreeText: { mutate: vi.fn(), isPending: false },
    reparseFromImage: { mutate: vi.fn(), isPending: false },
    updatePrescription: { mutate: vi.fn() },
    updateStructure: { mutate: vi.fn() },
    saveStructure: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe("LogSheet structure builder", () => {
  beforeEach(() => {
    mocks.usePlanDayExercises.mockReset();
    mocks.flags.emomBuilderEnabled = false;
    mocks.editor.onChange = undefined;
    mocks.editor.saveDebounceMs = undefined;
    mocks.editor.flush.mockReset();
    mocks.editor.flush.mockResolvedValue(true);
  });

  it("offers no block builder on a planned day while the builder is disabled (CL13)", () => {
    mocks.usePlanDayExercises.mockReturnValue(planDayState());

    render(<LogSheet entry={entry} onClose={vi.fn()} onLogAsPlanned={vi.fn()} />);

    expect(screen.getByTestId("log-workout-entry-1")).toBeInTheDocument();
    expect(screen.queryByTestId("structure-blocks-editor")).not.toBeInTheDocument();
  });

  it("offers the debounced block builder when the builder is enabled (CL13, U3)", () => {
    mocks.flags.emomBuilderEnabled = true;
    mocks.usePlanDayExercises.mockReturnValue(planDayState());

    render(<LogSheet entry={entry} onClose={vi.fn()} onLogAsPlanned={vi.fn()} />);

    expect(screen.getByTestId("structure-blocks-editor")).toBeInTheDocument();
    expect(mocks.editor.saveDebounceMs).toBeGreaterThan(0);
  });

  it("saves the day's blocks and the rows that follow them in one hook call (CL15)", async () => {
    mocks.flags.emomBuilderEnabled = true;
    const state = planDayState({ structureBlocks: [emomBlock] });
    mocks.usePlanDayExercises.mockReturnValue(state);
    render(<LogSheet entry={entry} onClose={vi.fn()} onLogAsPlanned={vi.fn()} />);
    const moves: StepLinkMove[] = [
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
    ];

    let saved: unknown;
    await act(async () => {
      saved = mocks.editor.onChange?.([emomBlock], moves);
      await saved;
    });

    expect(state.saveStructure).toHaveBeenCalledWith([emomBlock], moves);
    // The sheet no longer sequences relink PATCHes ahead of the blocks.
    expect(state.updateSet.mutateAsync).not.toHaveBeenCalled();
    expect(state.updateStructure.mutate).not.toHaveBeenCalled();
    // The save's promise reaches the builder, which reloads what is stored when it rejects.
    expect(saved).toBe(state.saveStructure.mock.results[0]?.value);
  });

  it("lands a block edit still waiting out its pause before completing the workout (CL15)", async () => {
    mocks.flags.emomBuilderEnabled = true;
    const order: string[] = [];
    let finishBlocks = (): void => undefined;
    mocks.editor.flush.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishBlocks = () => {
            order.push("blocks");
            resolve(true);
          };
        }),
    );
    const state = planDayState({
      structureBlocks: [emomBlock],
      flushPendingSetPatches: vi.fn(() => {
        order.push("rows");
        return Promise.resolve();
      }),
    });
    mocks.usePlanDayExercises.mockReturnValue(state);
    const onLogAsPlanned = vi.fn(() => {
      order.push("log");
      return Promise.resolve();
    });
    render(<LogSheet entry={entry} onClose={vi.fn()} onLogAsPlanned={onLogAsPlanned} />);

    fireEvent.click(screen.getByTestId("log-as-planned-entry-1"));
    await waitFor(() => {
      expect(mocks.editor.flush).toHaveBeenCalledTimes(1);
    });
    expect(onLogAsPlanned).not.toHaveBeenCalled();

    act(() => {
      finishBlocks();
    });

    await waitFor(() => {
      expect(onLogAsPlanned).toHaveBeenCalledTimes(1);
    });
    // Queued row links land first, so the block save moves them with their steps.
    expect(order).toEqual(["rows", "blocks", "log"]);
  });

  it("does not complete the workout when the block edit it sent fails (CL15)", async () => {
    mocks.flags.emomBuilderEnabled = true;
    mocks.editor.flush.mockResolvedValue(false);
    const state = planDayState({ structureBlocks: [emomBlock] });
    mocks.usePlanDayExercises.mockReturnValue(state);
    const onLogAsPlanned = vi.fn(() => Promise.resolve());
    render(<LogSheet entry={entry} onClose={vi.fn()} onLogAsPlanned={onLogAsPlanned} />);

    fireEvent.click(screen.getByTestId("log-as-planned-entry-1"));
    await waitFor(() => {
      expect(mocks.editor.flush).toHaveBeenCalledTimes(1);
    });

    // The log would copy the stored blocks the failed save fell back to.
    await waitFor(() => {
      expect(screen.getByTestId("log-as-planned-entry-1")).not.toBeDisabled();
    });
    expect(onLogAsPlanned).not.toHaveBeenCalled();
  });
});

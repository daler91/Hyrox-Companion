import type { StructureBlockInput } from "@shared/schema";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EDIT_SAVE_DEBOUNCE_MS } from "./editSaveDebounce";
import type { StepLinkMove } from "./stepLinks";
import { StructureBlocksEditor } from "./StructureBlocksEditor";

type ChangeHandler = (next: StructureBlockInput[], moves: readonly StepLinkMove[]) => unknown;

const qualityBlock: StructureBlockInput = {
  id: "block-quality",
  sectionType: "activation",
  formatType: "quality",
  instructions: "Hold race pace",
  workSeconds: 40,
  sequenceOrder: 0,
  sortOrder: 0,
  steps: [
    {
      stepNumber: 1,
      stepType: "work",
      exerciseName: "sled_push",
      category: "functional",
      customLabel: "Sled push 150kg",
      stepRole: "quality",
      intensity: { rpe: 8 },
      tempo: { pattern: "fast" },
      targets: { targetDistance: 50, targetWeight: 150 },
    },
  ],
};

const emomBlock: StructureBlockInput = {
  id: "block-emom",
  sectionType: "main",
  formatType: "emom",
  durationMinutes: 9,
  sequenceOrder: 1,
  sortOrder: 1,
  steps: [
    {
      stepNumber: 1,
      minuteIndex: 1,
      stepType: "work",
      exerciseName: "wall_balls",
      category: "functional",
      stepRole: "work",
      targets: { targetReps: 20 },
    },
    {
      stepNumber: 2,
      minuteIndex: 2,
      stepType: "work",
      exerciseName: "burpees",
      category: "conditioning",
      stepRole: "work",
      targets: { targetReps: 12 },
    },
    {
      stepNumber: 3,
      minuteIndex: 3,
      stepType: "work",
      exerciseName: "row",
      category: "conditioning",
      stepRole: "work",
      targets: { targetDistance: 250 },
    },
  ],
};

function emomBlockOnly(value: StructureBlockInput[]) {
  const block = value.at(0);
  if (!block) throw new Error("expected a block");
  return block;
}

describe("StructureBlocksEditor keeps what it does not edit (CL14)", () => {
  it("re-sends a block the athlete never touched exactly as it was stored", () => {
    const onChange = vi.fn<ChangeHandler>();
    render(<StructureBlocksEditor value={[qualityBlock, emomBlock]} onChange={onChange} />);

    // The EMOM is the second block; its first step is the second "Sec" field.
    fireEvent.change(screen.getAllByPlaceholderText("Sec")[1], { target: { value: "30" } });

    const [sent] = onChange.mock.calls[0];
    expect(sent[0]).toBe(qualityBlock);
    expect(sent[1].steps[0]).toEqual({
      ...emomBlock.steps[0],
      targets: { targetReps: 20, durationSeconds: 30 },
    });
    expect(sent[1].steps.slice(1)).toEqual(emomBlock.steps.slice(1));
  });

  it("keeps 'quality' and 'activation' and the step's metadata when that block is edited", () => {
    const onChange = vi.fn<ChangeHandler>();
    render(<StructureBlocksEditor value={[qualityBlock]} onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText("Sec"), { target: { value: "45" } });

    expect(onChange.mock.calls[0][0][0]).toEqual({
      ...qualityBlock,
      steps: [
        {
          ...qualityBlock.steps[0],
          targets: { targetDistance: 50, targetWeight: 150, durationSeconds: 45 },
        },
      ],
    });
  });
});

describe("StructureBlocksEditor reports renumbered steps (CL15)", () => {
  function Harness({ onChange }: { readonly onChange: ChangeHandler }) {
    const [value, setValue] = useState<StructureBlockInput[]>([emomBlock]);
    return (
      <StructureBlocksEditor
        value={value}
        onChange={(next, moves) => {
          setValue(next);
          return onChange(next, moves);
        }}
      />
    );
  }

  it("moves the later steps up and drops the removed one when a step is removed", () => {
    const onChange = vi.fn<ChangeHandler>();
    render(<Harness onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Min 1" }));

    const [next, moves] = onChange.mock.calls[0];
    expect(
      emomBlockOnly(next).steps.map((step) => [
        step.stepNumber,
        step.minuteIndex,
        step.exerciseName,
      ]),
    ).toEqual([
      [1, 1, "burpees"],
      [2, 2, "row"],
    ]);
    expect(moves).toEqual([
      {
        blockId: "block-emom",
        fromStepNumber: 1,
        toStepNumber: null,
        fromMinuteIndex: 1,
        toMinuteIndex: null,
        fromPatternLength: 3,
        toPatternLength: 2,
      },
      {
        blockId: "block-emom",
        fromStepNumber: 2,
        toStepNumber: 1,
        fromMinuteIndex: 2,
        toMinuteIndex: 1,
        fromPatternLength: 3,
        toPatternLength: 2,
      },
      {
        blockId: "block-emom",
        fromStepNumber: 3,
        toStepNumber: 2,
        fromMinuteIndex: 3,
        toMinuteIndex: 2,
        fromPatternLength: 3,
        toPatternLength: 2,
      },
    ]);
  });

  it("swaps the two steps a move exchanges", () => {
    const onChange = vi.fn<ChangeHandler>();
    render(<Harness onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Move Min 3 earlier" }));

    const [next, moves] = onChange.mock.calls[0];
    expect(emomBlockOnly(next).steps.map((step) => step.exerciseName)).toEqual([
      "wall_balls",
      "row",
      "burpees",
    ]);
    expect(moves).toEqual([
      {
        blockId: "block-emom",
        fromStepNumber: 2,
        toStepNumber: 3,
        fromMinuteIndex: 2,
        toMinuteIndex: 3,
        fromPatternLength: 3,
        toPatternLength: 3,
      },
      {
        blockId: "block-emom",
        fromStepNumber: 3,
        toStepNumber: 2,
        fromMinuteIndex: 3,
        toMinuteIndex: 2,
        fromPatternLength: 3,
        toPatternLength: 3,
      },
    ]);
  });

  it("measures the next edit's moves from what was saved, not from the first load", () => {
    const onChange = vi.fn<ChangeHandler>();
    render(<Harness onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Min 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Min 1" }));

    expect(onChange.mock.calls[1][1]).toEqual([
      {
        blockId: "block-emom",
        fromStepNumber: 1,
        toStepNumber: null,
        fromMinuteIndex: 1,
        toMinuteIndex: null,
        fromPatternLength: 2,
        toPatternLength: 1,
      },
      {
        blockId: "block-emom",
        fromStepNumber: 2,
        toStepNumber: 1,
        fromMinuteIndex: 2,
        toMinuteIndex: 1,
        fromPatternLength: 2,
        toPatternLength: 1,
      },
    ]);
  });

  it("reports the steps that stayed put when the EMOM pattern shrinks under them", () => {
    const onChange = vi.fn<ChangeHandler>();
    render(<Harness onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Min 3" }));

    // Their first-cycle rows stay; their later cycles now repeat every 2 minutes.
    expect(onChange.mock.calls[0][1]).toEqual([
      {
        blockId: "block-emom",
        fromStepNumber: 1,
        toStepNumber: 1,
        fromMinuteIndex: 1,
        toMinuteIndex: 1,
        fromPatternLength: 3,
        toPatternLength: 2,
      },
      {
        blockId: "block-emom",
        fromStepNumber: 2,
        toStepNumber: 2,
        fromMinuteIndex: 2,
        toMinuteIndex: 2,
        fromPatternLength: 3,
        toPatternLength: 2,
      },
      {
        blockId: "block-emom",
        fromStepNumber: 3,
        toStepNumber: null,
        fromMinuteIndex: 3,
        toMinuteIndex: null,
        fromPatternLength: 3,
        toPatternLength: 2,
      },
    ]);
  });

  it("reports nothing for an edit that renumbers no step", () => {
    const onChange = vi.fn<ChangeHandler>();
    render(<Harness onChange={onChange} />);

    fireEvent.change(screen.getAllByPlaceholderText("Sec")[0], { target: { value: "20" } });

    expect(onChange.mock.calls[0][1]).toEqual([]);
  });
});

/** What a server echo looks like: the same blocks with every unset column spelled null. */
function serverEcho(blocks: StructureBlockInput[]): StructureBlockInput[] {
  return blocks.map((block) => ({
    ...block,
    instructions: block.instructions ?? null,
    steps: block.steps.map((step) => ({
      ...step,
      customLabel: step.customLabel ?? null,
      groupId: step.groupId ?? null,
    })),
  }));
}

describe("StructureBlocksEditor saves after a pause (U3)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const ECHO_DELAY_MS = 100;

  /** Saves like the workout sheet: each save comes back from the server a little later. */
  function ServerHarness({ onSave }: { readonly onSave: ChangeHandler }) {
    const [value, setValue] = useState<StructureBlockInput[]>([emomBlock]);
    return (
      <StructureBlocksEditor
        value={value}
        saveDebounceMs={EDIT_SAVE_DEBOUNCE_MS}
        onChange={(next, moves) => {
          setTimeout(() => {
            setValue(serverEcho(next));
          }, ECHO_DELAY_MS);
          return onSave(next, moves);
        }}
      />
    );
  }

  function firstDuration(): HTMLInputElement {
    const input = screen.getAllByPlaceholderText("Sec")[0];
    if (!(input instanceof HTMLInputElement)) throw new Error("expected an input");
    return input;
  }

  it("saves once per pause instead of once per keystroke", () => {
    const onSave = vi.fn<ChangeHandler>();
    render(<ServerHarness onSave={onSave} />);

    fireEvent.change(firstDuration(), { target: { value: "4" } });
    fireEvent.change(firstDuration(), { target: { value: "45" } });
    expect(onSave).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(EDIT_SAVE_DEBOUNCE_MS);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(emomBlockOnly(onSave.mock.calls[0][0]).steps[0].targets).toEqual({
      targetReps: 20,
      durationSeconds: 45,
    });
  });

  it("keeps the focused field and the digits typed while the previous save echoes back", () => {
    const onSave = vi.fn<ChangeHandler>();
    render(<ServerHarness onSave={onSave} />);
    const input = firstDuration();
    input.focus();

    fireEvent.change(input, { target: { value: "4" } });
    act(() => {
      vi.advanceTimersByTime(EDIT_SAVE_DEBOUNCE_MS);
    });
    // The athlete types the second digit before the first save comes back.
    fireEvent.change(input, { target: { value: "45" } });
    act(() => {
      vi.advanceTimersByTime(ECHO_DELAY_MS);
    });

    expect(firstDuration()).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input).toHaveValue(45);

    act(() => {
      vi.advanceTimersByTime(EDIT_SAVE_DEBOUNCE_MS + ECHO_DELAY_MS);
    });

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(emomBlockOnly(onSave.mock.calls[1][0]).steps[0].targets).toEqual({
      targetReps: 20,
      durationSeconds: 45,
    });
    // The echo of the second save is adopted without remounting the row.
    expect(firstDuration()).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input).toHaveValue(45);
  });

  it("sends a save still waiting when the editor unmounts", () => {
    const onSave = vi.fn<ChangeHandler>();
    const { unmount } = render(<ServerHarness onSave={onSave} />);

    fireEvent.change(firstDuration(), { target: { value: "30" } });
    unmount();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(emomBlockOnly(onSave.mock.calls[0][0]).steps[0].targets).toEqual({
      targetReps: 20,
      durationSeconds: 30,
    });
  });

  it("shows the stored blocks again when the save is rejected", async () => {
    const onChange = vi.fn<ChangeHandler>(() => Promise.reject(new Error("relink failed")));
    render(
      <StructureBlocksEditor
        value={[emomBlock]}
        onChange={onChange}
        saveDebounceMs={EDIT_SAVE_DEBOUNCE_MS}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Min 1" }));
    expect(screen.getAllByTestId("structure-block-step")).toHaveLength(2);

    await act(async () => {
      vi.advanceTimersByTime(EDIT_SAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId("structure-block-step")).toHaveLength(3);
  });
});

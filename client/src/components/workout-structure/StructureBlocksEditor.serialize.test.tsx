import type { StructureBlockInput } from "@shared/schema";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeExerciseSet } from "@/test/factories/exerciseSetFactory";

import { EDIT_SAVE_DEBOUNCE_MS } from "./editSaveDebounce";
import type { StepLinkMove } from "./stepLinks";
import { StructureBlocksEditor, type StructureBlocksEditorHandle } from "./StructureBlocksEditor";

type ChangeHandler = (next: StructureBlockInput[], moves: readonly StepLinkMove[]) => unknown;

const emomBlock: StructureBlockInput = {
  id: "block-emom",
  sectionType: "main",
  formatType: "emom",
  durationMinutes: 9,
  sequenceOrder: 0,
  sortOrder: 0,
  steps: [
    {
      stepNumber: 1,
      minuteIndex: 1,
      stepType: "work",
      exerciseName: "wall_balls",
      stepRole: "work",
    },
    { stepNumber: 2, minuteIndex: 2, stepType: "work", exerciseName: "burpees", stepRole: "work" },
    { stepNumber: 3, minuteIndex: 3, stepType: "work", exerciseName: "row", stepRole: "work" },
  ],
};

const linkedRows = [
  makeExerciseSet({
    id: "wall-1",
    exerciseName: "wall_balls",
    blockId: "block-emom",
    stepNumber: 1,
    intervalMinute: 1,
  }),
  makeExerciseSet({
    id: "burpee-1",
    exerciseName: "burpees",
    blockId: "block-emom",
    stepNumber: 2,
    intervalMinute: 2,
  }),
  makeExerciseSet({
    id: "row-1",
    exerciseName: "rowing",
    blockId: "block-emom",
    stepNumber: 3,
    intervalMinute: 3,
  }),
];

/** A save the test settles by hand. */
function deferredSaves() {
  const settle: { resolve: () => void; reject: () => void }[] = [];
  const onChange = vi.fn<ChangeHandler>(
    () =>
      new Promise<void>((resolve, reject) => {
        settle.push({
          resolve,
          reject: () => {
            reject(new Error("save failed"));
          },
        });
      }),
  );
  return { onChange, settle };
}

async function settleNext(
  settle: { resolve: () => void; reject: () => void }[],
  outcome: "resolve" | "reject",
) {
  await act(async () => {
    const next = settle.shift();
    if (outcome === "resolve") next?.resolve();
    else next?.reject();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function removeFirstStep() {
  fireEvent.click(screen.getByRole("button", { name: "Remove Min 1" }));
}

function pause() {
  act(() => {
    vi.advanceTimersByTime(EDIT_SAVE_DEBOUNCE_MS);
  });
}

describe("StructureBlocksEditor sends one save at a time (U3, CL15)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the next save until the one in flight lands, and measures it from what that saved", async () => {
    const { onChange, settle } = deferredSaves();
    render(
      <StructureBlocksEditor
        value={[emomBlock]}
        onChange={onChange}
        saveDebounceMs={EDIT_SAVE_DEBOUNCE_MS}
      />,
    );

    removeFirstStep();
    pause();
    removeFirstStep();
    pause();

    expect(onChange).toHaveBeenCalledTimes(1);

    await settleNext(settle, "resolve");

    expect(onChange).toHaveBeenCalledTimes(2);
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

  it("measures an edit made before the landed save has re-rendered from what that save stored", async () => {
    const { onChange, settle } = deferredSaves();
    const view = render(
      <StructureBlocksEditor
        value={[emomBlock]}
        onChange={onChange}
        saveDebounceMs={EDIT_SAVE_DEBOUNCE_MS}
      />,
    );

    removeFirstStep();
    pause();
    // The owner shows what it is saving, as the cache's optimistic copy does.
    view.rerender(
      <StructureBlocksEditor
        value={onChange.mock.calls[0][0]}
        onChange={onChange}
        saveDebounceMs={EDIT_SAVE_DEBOUNCE_MS}
      />,
    );
    // The save lands and, before the builder re-renders, the athlete removes
    // the next step through the handler the last render gave it.
    await act(async () => {
      settle.shift()?.resolve();
      await Promise.resolve();
      await Promise.resolve();
      removeFirstStep();
    });
    pause();

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0][0].steps.map((step) => step.exerciseName)).toEqual(["row"]);
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

  it("measures the next save from what is stored when the one in flight fails", async () => {
    const { onChange, settle } = deferredSaves();
    render(
      <StructureBlocksEditor
        value={[emomBlock]}
        onChange={onChange}
        saveDebounceMs={EDIT_SAVE_DEBOUNCE_MS}
      />,
    );

    removeFirstStep();
    pause();
    removeFirstStep();
    pause();
    await settleNext(settle, "reject");

    // Both removals, against the stored [Wall balls, Burpees, Row].
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0][0].steps.map((step) => step.exerciseName)).toEqual(["row"]);
    expect(onChange.mock.calls[1][1]).toEqual([
      {
        blockId: "block-emom",
        fromStepNumber: 1,
        toStepNumber: null,
        fromMinuteIndex: 1,
        toMinuteIndex: null,
        fromPatternLength: 3,
        toPatternLength: 1,
      },
      {
        blockId: "block-emom",
        fromStepNumber: 2,
        toStepNumber: null,
        fromMinuteIndex: 2,
        toMinuteIndex: null,
        fromPatternLength: 3,
        toPatternLength: 1,
      },
      {
        blockId: "block-emom",
        fromStepNumber: 3,
        toStepNumber: 1,
        fromMinuteIndex: 3,
        toMinuteIndex: 1,
        fromPatternLength: 3,
        toPatternLength: 1,
      },
    ]);
  });

  it("links a row assigned during the pause only after the pending save, with the new step number", async () => {
    const { onChange, settle } = deferredSaves();
    const onAddSet = vi.fn();
    render(
      <StructureBlocksEditor
        value={[emomBlock]}
        onChange={onChange}
        saveDebounceMs={EDIT_SAVE_DEBOUNCE_MS}
        exerciseSets={linkedRows}
        onUpdateSet={vi.fn()}
        onAddSet={onAddSet}
      />,
    );

    removeFirstStep();
    // Inside the pause, the athlete adds a row to Row, now shown as Min 2.
    fireEvent.click(screen.getAllByTestId("structure-block-add-linked-row")[1]);

    // The save went first, measured from the stored numbering...
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][1]).toContainEqual({
      blockId: "block-emom",
      fromStepNumber: 3,
      toStepNumber: 2,
      fromMinuteIndex: 3,
      toMinuteIndex: 2,
      fromPatternLength: 3,
      toPatternLength: 2,
    });
    expect(onAddSet).not.toHaveBeenCalled();

    await settleNext(settle, "resolve");

    // ...and the new row was added on the numbering that save stored.
    expect(onAddSet).toHaveBeenCalledTimes(1);
    expect(onAddSet).toHaveBeenCalledWith(
      expect.objectContaining({ blockId: "block-emom", stepNumber: 2 }),
    );
  });

  it("drops an assignment made during the pause when the save before it fails", async () => {
    const { onChange, settle } = deferredSaves();
    const onAddSet = vi.fn();
    render(
      <StructureBlocksEditor
        value={[emomBlock]}
        onChange={onChange}
        saveDebounceMs={EDIT_SAVE_DEBOUNCE_MS}
        exerciseSets={linkedRows}
        onUpdateSet={vi.fn()}
        onAddSet={onAddSet}
      />,
    );

    removeFirstStep();
    fireEvent.click(screen.getAllByTestId("structure-block-add-linked-row")[1]);
    await settleNext(settle, "reject");

    expect(onAddSet).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("structure-block-step")).toHaveLength(3);
  });
});

describe("StructureBlocksEditor flush handle (CL15)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a save still waiting out its pause and resolves once it lands", async () => {
    const { onChange, settle } = deferredSaves();
    const ref = createRef<StructureBlocksEditorHandle>();
    render(
      <StructureBlocksEditor
        ref={ref}
        value={[emomBlock]}
        onChange={onChange}
        saveDebounceMs={EDIT_SAVE_DEBOUNCE_MS}
      />,
    );
    removeFirstStep();

    let flushed: boolean | undefined;
    let flushing: Promise<void> | undefined;
    act(() => {
      flushing = ref.current?.flush().then((saved) => {
        flushed = saved;
      });
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(flushed).toBeUndefined();

    await settleNext(settle, "resolve");

    expect(flushed).toBe(true);
    await expect(flushing).resolves.toBeUndefined();
  });

  it("resolves false, without rejecting, when the save fails", async () => {
    const { onChange, settle } = deferredSaves();
    const ref = createRef<StructureBlocksEditorHandle>();
    render(
      <StructureBlocksEditor
        ref={ref}
        value={[emomBlock]}
        onChange={onChange}
        saveDebounceMs={EDIT_SAVE_DEBOUNCE_MS}
      />,
    );
    removeFirstStep();

    let flushed: boolean | undefined;
    let flushing: Promise<void> | undefined;
    act(() => {
      flushing = ref.current?.flush().then((saved) => {
        flushed = saved;
      });
    });
    await settleNext(settle, "reject");

    expect(flushed).toBe(false);
    await expect(flushing).resolves.toBeUndefined();
  });

  it("resolves at once when nothing is waiting", async () => {
    const ref = createRef<StructureBlocksEditorHandle>();
    render(
      <StructureBlocksEditor
        ref={ref}
        value={[emomBlock]}
        onChange={vi.fn()}
        saveDebounceMs={EDIT_SAVE_DEBOUNCE_MS}
      />,
    );

    await expect(ref.current?.flush()).resolves.toBe(true);
  });
});

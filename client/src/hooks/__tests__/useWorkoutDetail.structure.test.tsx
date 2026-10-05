import type { ExerciseSet, StructureBlockInput } from "@shared/schema";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { SetRelink, StepLinkMove } from "@/components/workout-structure";
import { useWorkoutDetail } from "@/hooks/useWorkoutDetail";
import { api, QUERY_KEYS, type WorkoutDetail } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { makeExerciseSet } from "@/test/factories/exerciseSetFactory";

// Same seams as the rollback spec: useApiMutation hands its config back, so the
// test runs updateStructure's callbacks itself and watches what they send.
vi.mock("@/hooks/useApiMutation", async () =>
  (await import("@/test/support/workoutDetailHookMocks")).makeApiMutationPassthroughMock(),
);

vi.mock("@/lib/queryClient", async (importOriginal) =>
  (await import("@/test/support/workoutDetailHookMocks")).makeRealQueryClientMock(importOriginal),
);

vi.mock("@/lib/api", async (importOriginal) =>
  (await import("@/test/support/workoutDetailHookMocks")).makeWorkoutReadsApiMock(importOriginal),
);

const WORKOUT_ID = "workout-1";

const emomBlock: StructureBlockInput = {
  id: "block-emom",
  sectionType: "main",
  formatType: "emom",
  durationMinutes: 8,
  steps: [
    { stepNumber: 1, minuteIndex: 1, stepType: "work", exerciseName: "burpees" },
    { stepNumber: 2, minuteIndex: 2, stepType: "work", exerciseName: "row" },
  ],
};
// Burpees (step 1) removed: Row moves up to step 1.
const savedBlock: StructureBlockInput = { ...emomBlock, steps: emomBlock.steps.slice(0, 1) };
const removeFirst: StepLinkMove[] = [
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
const relinks: SetRelink[] = [
  {
    setId: "wall-1",
    fromBlockId: "block-emom",
    fromStepNumber: 1,
    blockId: null,
    stepNumber: null,
  },
  {
    setId: "burpee-1",
    fromBlockId: "block-emom",
    fromStepNumber: 2,
    blockId: "block-emom",
    stepNumber: 1,
    intervalMinute: 1,
  },
];

function storedRows(): ExerciseSet[] {
  return [
    makeExerciseSet({
      id: "wall-1",
      blockId: "block-emom",
      stepNumber: 1,
      intervalMinute: 1,
      reps: 20,
    }),
    makeExerciseSet({
      id: "burpee-1",
      blockId: "block-emom",
      stepNumber: 2,
      intervalMinute: 2,
      reps: 10,
    }),
    makeExerciseSet({ id: "squat-1", blockId: null, stepNumber: null, reps: 5 }),
  ];
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

interface SaveVariables {
  workoutId: string;
  structureBlocks: StructureBlockInput[];
  relinks: SetRelink[];
}

interface StructureSaveConfig {
  scope?: { id: string };
  mutationFn: (variables: SaveVariables) => Promise<unknown>;
  onMutate: (variables: SaveVariables) => Promise<unknown>;
  onSuccess: (data: unknown, variables: SaveVariables) => void;
  onError: (error: Error, variables: SaveVariables, context: unknown) => void;
}

interface MutationDouble {
  config: StructureSaveConfig;
  mutateAsync: Mock<(variables: unknown) => Promise<unknown>>;
}

function renderDetail(workoutId: string | null = WORKOUT_ID) {
  const { result, unmount } = renderHook(() => useWorkoutDetail(workoutId), { wrapper });
  return {
    result,
    unmount,
    save: () => result.current.updateStructure as unknown as MutationDouble,
  };
}

function cachedWorkout(): WorkoutDetail | undefined {
  return queryClient.getQueryData<WorkoutDetail>(QUERY_KEYS.workout(WORKOUT_ID));
}

describe("useWorkoutDetail block saves (CL15)", () => {
  beforeEach(() => {
    queryClient.clear();
    queryClient.setQueryData(QUERY_KEYS.workout(WORKOUT_ID), {
      id: WORKOUT_ID,
      exerciseSets: storedRows(),
      structureBlocks: [emomBlock],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the blocks and the rows that follow them in ONE request", async () => {
    const update = vi.spyOn(api.workouts, "update").mockResolvedValue({} as never);
    const { save } = renderDetail();

    await save().config.mutationFn({
      workoutId: WORKOUT_ID,
      structureBlocks: [savedBlock],
      relinks,
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(WORKOUT_ID, { structureBlocks: [savedBlock], relinks });
  });

  it("still saves to the workout it was made in once the sheet has closed", async () => {
    const update = vi.spyOn(api.workouts, "update").mockResolvedValue({} as never);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    // A closed sheet renders the hook with no workout.
    const { save } = renderDetail(null);

    await save().config.mutationFn({
      workoutId: WORKOUT_ID,
      structureBlocks: [savedBlock],
      relinks: [],
    });
    save().config.onSuccess(
      {},
      { workoutId: WORKOUT_ID, structureBlocks: [savedBlock], relinks: [] },
    );

    expect(update).toHaveBeenCalledWith(WORKOUT_ID, { structureBlocks: [savedBlock], relinks: [] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: QUERY_KEYS.workout(WORKOUT_ID) });
  });

  it("runs every block save in one queue, whichever workout the sheet shows (U3)", () => {
    const first = renderDetail(WORKOUT_ID).save().config.scope;
    const second = renderDetail("workout-2").save().config.scope;
    const closed = renderDetail(null).save().config.scope;

    expect(typeof first?.id).toBe("string");
    expect(second).toEqual(first);
    expect(closed).toEqual(first);
  });

  it("computes the relinks from the cached rows and sends them with the blocks", async () => {
    const { result, save } = renderDetail();

    await result.current.saveStructure([savedBlock], removeFirst);

    expect(save().mutateAsync).toHaveBeenCalledWith({
      workoutId: WORKOUT_ID,
      structureBlocks: [savedBlock],
      relinks,
    });
  });

  it("sends a row put on a step in the pause before the save first, so the relinks move it too", async () => {
    const { result, save } = renderDetail();
    const order: string[] = [];
    // The row lands where the athlete put it, under the numbering the save renumbers.
    const updateSet = result.current.updateSet as unknown as MutationDouble;
    updateSet.mutateAsync.mockImplementation(() => {
      order.push("row");
      queryClient.setQueryData<WorkoutDetail>(QUERY_KEYS.workout(WORKOUT_ID), (prev) =>
        prev
          ? {
              ...prev,
              exerciseSets: prev.exerciseSets?.map((set) =>
                set.id === "squat-1"
                  ? { ...set, blockId: "block-emom", stepNumber: 2, intervalMinute: 2 }
                  : set,
              ),
            }
          : prev,
      );
      return Promise.resolve();
    });
    save().mutateAsync.mockImplementation(() => {
      order.push("blocks");
      return Promise.resolve();
    });

    act(() => {
      result.current.patchSetDebounced("squat-1", {
        blockId: "block-emom",
        stepNumber: 2,
        intervalMinute: 2,
      });
    });
    await result.current.saveStructure([savedBlock], removeFirst);

    expect(order).toEqual(["row", "blocks"]);
    expect(save().mutateAsync).toHaveBeenCalledWith({
      workoutId: WORKOUT_ID,
      structureBlocks: [savedBlock],
      relinks: [
        ...relinks,
        {
          setId: "squat-1",
          fromBlockId: "block-emom",
          fromStepNumber: 2,
          blockId: "block-emom",
          stepNumber: 1,
          intervalMinute: 1,
        },
      ],
    });
  });

  it("waits for a row PATCH the closing sheet already sent before it sends the blocks", async () => {
    // Closing the sheet sends the queued row PATCH without waiting for it, then
    // the builder's unmount sends its waiting save. Sent beside the row PATCH,
    // the blocks could land first and miss the row (CL15).
    const { result, save, unmount } = renderDetail();
    const order: string[] = [];
    let landRow: () => void = () => undefined;
    const updateSet = result.current.updateSet as unknown as MutationDouble;
    updateSet.mutateAsync.mockImplementation(() => {
      order.push("row sent");
      return new Promise<void>((resolve) => {
        landRow = () => {
          order.push("row landed");
          resolve();
        };
      });
    });
    save().mutateAsync.mockImplementation(() => {
      order.push("blocks");
      return Promise.resolve();
    });

    act(() => {
      result.current.patchSetDebounced("squat-1", {
        blockId: "block-emom",
        stepNumber: 2,
        intervalMinute: 2,
      });
    });
    // The builder keeps the save it rendered with, which names the workout.
    const saveFromBuilder = result.current.saveStructure;
    unmount();
    expect(order).toEqual(["row sent"]);

    const saved = saveFromBuilder([savedBlock], removeFirst);
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["row sent"]);

    landRow();
    await saved;
    expect(order).toEqual(["row sent", "row landed", "blocks"]);
  });

  it("moves the cached rows with the blocks at once", async () => {
    const { save } = renderDetail();

    await save().config.onMutate({ workoutId: WORKOUT_ID, structureBlocks: [savedBlock], relinks });

    expect(cachedWorkout()?.structureBlocks).toEqual([savedBlock]);
    expect(
      cachedWorkout()?.exerciseSets?.map((set) => [set.id, set.blockId, set.stepNumber]),
    ).toEqual([
      ["wall-1", null, null],
      ["burpee-1", "block-emom", 1],
      ["squat-1", null, null],
    ]);
  });

  it("puts back the blocks and only the rows the failed save moved", async () => {
    const { save } = renderDetail();
    const variables = { workoutId: WORKOUT_ID, structureBlocks: [savedBlock], relinks };
    const context = await save().config.onMutate(variables);
    // A reps edit to the burpee row landed while the save was out.
    queryClient.setQueryData<WorkoutDetail>(QUERY_KEYS.workout(WORKOUT_ID), (prev) =>
      prev
        ? {
            ...prev,
            exerciseSets: prev.exerciseSets?.map((set) =>
              set.id === "burpee-1" ? { ...set, reps: 12 } : set,
            ),
          }
        : prev,
    );

    save().config.onError(new Error("500: boom"), variables, context);

    expect(cachedWorkout()?.structureBlocks).toEqual([emomBlock]);
    expect(
      cachedWorkout()?.exerciseSets?.map((set) => [set.id, set.blockId, set.stepNumber, set.reps]),
    ).toEqual([
      ["wall-1", "block-emom", 1, 20],
      ["burpee-1", "block-emom", 2, 12],
      ["squat-1", null, null, 5],
    ]);
  });
});

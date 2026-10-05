import type { ExerciseSet, StructureBlockInput } from "@shared/schema";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StepLinkMove } from "@/components/workout-structure";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient as appQueryClient } from "@/lib/queryClient";
import { makeExerciseSet } from "@/test/factories/exerciseSetFactory";

import { usePlanDayExercises } from "../usePlanDayExercises";

type DayData = { exerciseSets: ExerciseSet[]; structureBlocks: StructureBlockInput[] };

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  getDayExercises: vi.fn<(dayId: string) => Promise<DayData>>(),
  updateDayExercise:
    vi.fn<(dayId: string, setId: string, data: Partial<ExerciseSet>) => Promise<ExerciseSet>>(),
  typedRequest: vi.fn<(method: string, url: string, body?: unknown) => Promise<unknown>>(),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/useUnitPreferences", () => ({
  useUnitPreferences: () => ({ weightUnit: "kg", distanceUnit: "km" }),
}));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  typedRequest: mocks.typedRequest,
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      plans: {
        ...actual.api.plans,
        getDayExercises: mocks.getDayExercises,
        updateDayExercise: mocks.updateDayExercise,
      },
    },
  };
});

const DAY_ID = "day-1";
const STRUCTURE_URL = `/api/v1/plans/days/${DAY_ID}/structure`;

const storedBlock: StructureBlockInput = {
  id: "block-emom",
  sectionType: "main",
  formatType: "emom",
  durationMinutes: 9,
  steps: [
    { stepNumber: 1, minuteIndex: 1, stepType: "work", exerciseName: "wall_balls" },
    { stepNumber: 2, minuteIndex: 2, stepType: "work", exerciseName: "burpees" },
  ],
};
// Wall balls removed: Burpees moves up to step 1.
const savedBlock: StructureBlockInput = {
  ...storedBlock,
  steps: [{ stepNumber: 1, minuteIndex: 1, stepType: "work", exerciseName: "burpees" }],
};
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
const storedRows = [
  makeExerciseSet({
    id: "wall-1",
    planDayId: DAY_ID,
    workoutLogId: null,
    blockId: "block-emom",
    stepNumber: 1,
    intervalMinute: 1,
    reps: 20,
  }),
  makeExerciseSet({
    id: "burpee-1",
    planDayId: DAY_ID,
    workoutLogId: null,
    blockId: "block-emom",
    stepNumber: 2,
    intervalMinute: 2,
    reps: 10,
  }),
];
const expectedRelinks = [
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

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={appQueryClient}>{children}</QueryClientProvider>;
}

/** Each structure PATCH waits until the test settles it. */
function deferStructureSaves() {
  const pending: { resolve: (data: DayData) => void; reject: (error: Error) => void }[] = [];
  mocks.typedRequest.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return pending;
}

async function renderDay() {
  const initialProps: { id: string | null } = { id: DAY_ID };
  const hook = renderHook(({ id }) => usePlanDayExercises(id), { initialProps, wrapper });
  await waitFor(() => {
    expect(hook.result.current.exerciseSets).toHaveLength(2);
  });
  return hook;
}

function cachedDay(): DayData | undefined {
  return appQueryClient.getQueryData<DayData>(QUERY_KEYS.planDayExercises(DAY_ID));
}

describe("usePlanDayExercises block saves (CL15)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appQueryClient.clear();
    mocks.getDayExercises.mockResolvedValue({
      exerciseSets: storedRows,
      structureBlocks: [storedBlock],
    });
  });

  it("sends the blocks and the rows that follow them in ONE request", async () => {
    mocks.typedRequest.mockResolvedValue({
      exerciseSets: storedRows,
      structureBlocks: [savedBlock],
    });
    const sendStructure = vi.spyOn(api.plans, "updateDayStructure");
    const { result } = await renderDay();

    await act(async () => {
      await result.current.saveStructure([savedBlock], removeFirst);
    });

    // Through the plan API, not a request of its own beside it.
    expect(sendStructure).toHaveBeenCalledWith(DAY_ID, [savedBlock], expectedRelinks);
    expect(mocks.typedRequest).toHaveBeenCalledTimes(1);
    expect(mocks.typedRequest).toHaveBeenCalledWith("PATCH", STRUCTURE_URL, {
      structureBlocks: [savedBlock],
      relinks: expectedRelinks,
    });
  });

  it("sends one save at a time, and still saves to the day once the sheet has closed", async () => {
    const pending = deferStructureSaves();
    const { result, rerender } = await renderDay();

    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    act(() => {
      first = result.current.saveStructure([savedBlock], removeFirst);
      second = result.current.saveStructure([savedBlock], []);
    });
    await waitFor(() => {
      expect(mocks.typedRequest).toHaveBeenCalledTimes(1);
    });

    // The athlete closes the sheet while the first save is out.
    rerender({ id: null });
    await act(async () => {
      pending.shift()?.resolve({ exerciseSets: storedRows, structureBlocks: [savedBlock] });
      await first;
    });

    await waitFor(() => {
      expect(mocks.typedRequest).toHaveBeenCalledTimes(2);
    });
    expect(mocks.typedRequest).toHaveBeenLastCalledWith("PATCH", STRUCTURE_URL, {
      structureBlocks: [savedBlock],
      relinks: [],
    });
    await act(async () => {
      pending.shift()?.resolve({ exerciseSets: storedRows, structureBlocks: [savedBlock] });
      await second;
    });
  });

  it("sends a row put on a step in the pause before the save first, so the relinks move it too", async () => {
    const order: string[] = [];
    mocks.updateDayExercise.mockImplementation((_dayId, setId, data) => {
      order.push("row");
      const row = storedRows.find((set) => set.id === setId);
      return row ? Promise.resolve({ ...row, ...data }) : Promise.reject(new Error("404"));
    });
    mocks.typedRequest.mockImplementation(() => {
      order.push("blocks");
      return Promise.resolve({ exerciseSets: storedRows, structureBlocks: [savedBlock] });
    });
    const { result } = await renderDay();

    // Inside the pause after removing wall balls, the athlete puts the wall
    // ball row on burpees, still step 2 in the numbering the save replaces.
    act(() => {
      result.current.patchSetDebounced("wall-1", {
        blockId: "block-emom",
        stepNumber: 2,
        intervalMinute: 2,
      });
    });
    await act(async () => {
      await result.current.saveStructure([savedBlock], removeFirst);
    });

    expect(order).toEqual(["row", "blocks"]);
    expect(mocks.typedRequest).toHaveBeenCalledWith("PATCH", STRUCTURE_URL, {
      structureBlocks: [savedBlock],
      relinks: [
        {
          setId: "wall-1",
          fromBlockId: "block-emom",
          fromStepNumber: 2,
          blockId: "block-emom",
          stepNumber: 1,
          intervalMinute: 1,
        },
        expectedRelinks[1],
      ],
    });
  });

  it("waits for a row PATCH the closing sheet already sent before it sends the blocks", async () => {
    // Closing the sheet sends the queued row PATCH without waiting for it, then
    // the builder's unmount sends its waiting save. Sent beside the row PATCH,
    // the blocks could land first and miss the row (CL15).
    const order: string[] = [];
    let landRow: () => void = () => undefined;
    mocks.updateDayExercise.mockImplementation((_dayId, setId, data) => {
      order.push("row sent");
      const row = storedRows.find((set) => set.id === setId);
      return new Promise((resolve, reject) => {
        landRow = () => {
          order.push("row landed");
          if (row) resolve({ ...row, ...data });
          else reject(new Error("404"));
        };
      });
    });
    mocks.typedRequest.mockImplementation(() => {
      order.push("blocks");
      return Promise.resolve({ exerciseSets: storedRows, structureBlocks: [savedBlock] });
    });
    const { result, rerender } = await renderDay();

    act(() => {
      result.current.patchSetDebounced("wall-1", {
        blockId: "block-emom",
        stepNumber: 2,
        intervalMinute: 2,
      });
    });
    // The builder keeps the save it rendered with, which names the day.
    const saveFromBuilder = result.current.saveStructure;
    rerender({ id: null });
    await waitFor(() => {
      expect(order).toEqual(["row sent"]);
    });

    let save: Promise<unknown> = Promise.resolve();
    act(() => {
      save = saveFromBuilder([savedBlock], removeFirst);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.typedRequest).not.toHaveBeenCalled();

    await act(async () => {
      landRow();
      await save;
    });

    expect(order).toEqual(["row sent", "row landed", "blocks"]);
    expect(mocks.typedRequest).toHaveBeenCalledWith("PATCH", STRUCTURE_URL, {
      structureBlocks: [savedBlock],
      relinks: [
        {
          setId: "wall-1",
          fromBlockId: "block-emom",
          fromStepNumber: 2,
          blockId: "block-emom",
          stepNumber: 1,
          intervalMinute: 1,
        },
        expectedRelinks[1],
      ],
    });
  });

  it("moves the cached rows at once and puts back only those rows when the save fails", async () => {
    const pending = deferStructureSaves();
    const { result } = await renderDay();

    let save: Promise<unknown> = Promise.resolve();
    act(() => {
      save = result.current.saveStructure([savedBlock], removeFirst);
    });
    await waitFor(() => {
      expect(cachedDay()?.exerciseSets.map((set) => [set.id, set.stepNumber])).toEqual([
        ["wall-1", null],
        ["burpee-1", 1],
      ]);
    });
    expect(cachedDay()?.structureBlocks).toEqual([savedBlock]);

    // A reps edit to the burpee row landed while the save was out.
    appQueryClient.setQueryData<DayData>(QUERY_KEYS.planDayExercises(DAY_ID), (prev) =>
      prev
        ? {
            ...prev,
            exerciseSets: prev.exerciseSets.map((set) =>
              set.id === "burpee-1" ? { ...set, reps: 12 } : set,
            ),
          }
        : prev,
    );
    await act(async () => {
      pending.shift()?.reject(new Error("404: Exercise set not found"));
      await expect(save).rejects.toThrow("404");
    });

    expect(cachedDay()?.structureBlocks).toEqual([storedBlock]);
    expect(
      cachedDay()?.exerciseSets.map((set) => [set.id, set.blockId, set.stepNumber, set.reps]),
    ).toEqual([
      ["wall-1", "block-emom", 1, 20],
      ["burpee-1", "block-emom", 2, 12],
    ]);
    // One toast for the failed save; no set-level toast beside it.
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't save workout blocks" }),
    );
  });
});

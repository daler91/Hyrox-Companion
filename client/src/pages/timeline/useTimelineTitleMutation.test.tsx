import type { TimelineEntry } from "@shared/schema";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QUERY_KEYS } from "@/lib/api";

import { useTimelineTitleMutation } from "./useTimelineTitleMutation";

const apiMocks = vi.hoisted(() => ({
  plansUpdateDayWithoutPlan: vi.fn(),
  workoutsUpdate: vi.fn(),
}));

const queryClientMocks = vi.hoisted(() => ({
  cancelQueries: vi.fn(),
  getQueryData: vi.fn(),
  setQueriesData: vi.fn(),
  setQueryData: vi.fn(),
}));

type RenameVariables = { entry: TimelineEntry; title: string };
type RenameContext = {
  readonly targetKey: string | null;
  readonly previousWorkoutFocus?: string | null;
};
type MutationConfig = {
  mutationFn: (variables: RenameVariables) => Promise<unknown>;
  onMutate: (variables: RenameVariables) => Promise<RenameContext>;
  onError: (
    error: Error,
    variables: RenameVariables,
    context: RenameContext | undefined,
  ) => void;
  onSettled: (
    data: unknown,
    error: Error | null,
    variables: RenameVariables,
    context: RenameContext | undefined,
  ) => void;
};

const mutationHarness = vi.hoisted(() => ({
  config: undefined as MutationConfig | undefined,
}));

vi.mock("@/hooks/useApiMutation", () => ({
  useApiMutation: (config: MutationConfig) => {
    mutationHarness.config = config;
    return { mutate: vi.fn(), isPending: false };
  },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      plans: {
        ...actual.api.plans,
        updateDayWithoutPlan: apiMocks.plansUpdateDayWithoutPlan,
      },
      workouts: {
        ...actual.api.workouts,
        update: apiMocks.workoutsUpdate,
      },
    },
  };
});

vi.mock("@/lib/queryClient", () => ({
  queryClient: queryClientMocks,
}));

function makeEntry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: "entry-1",
    date: "2026-05-17",
    type: "logged",
    status: "completed",
    focus: "Old title",
    mainWorkout: "Main",
    accessory: null,
    notes: null,
    workoutLogId: "workout-1",
    planDayId: "day-1",
    ...overrides,
  };
}

function makeSetters(initialEntry: TimelineEntry = makeEntry()) {
  let reviewEntry: TimelineEntry | null = initialEntry;
  return {
    setPreviewEntry: vi.fn(),
    setFutureEditEntry: vi.fn(),
    setLogEntry: vi.fn(),
    setReviewEntry: vi.fn((updater: TimelineEntry | null | ((entry: TimelineEntry | null) => TimelineEntry | null)) => {
      reviewEntry = typeof updater === "function" ? updater(reviewEntry) : updater;
    }),
    setSkippedEntry: vi.fn(),
    getReviewEntry: () => reviewEntry,
  };
}

function renderMutation(setters = makeSetters()) {
  const { result } = renderHook(() => useTimelineTitleMutation(setters));
  if (!mutationHarness.config) throw new Error("Expected useApiMutation config");
  return { config: mutationHarness.config, result, setters };
}

describe("useTimelineTitleMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationHarness.config = undefined;
    apiMocks.workoutsUpdate.mockResolvedValue({});
    apiMocks.plansUpdateDayWithoutPlan.mockResolvedValue({});
    queryClientMocks.cancelQueries.mockResolvedValue(undefined);
    queryClientMocks.getQueryData.mockReturnValue(undefined);
  });

  it("updates workout logs when a workoutLogId exists", async () => {
    const { config } = renderMutation();
    const entry = makeEntry({ workoutLogId: "workout-1", planDayId: "day-1" });

    await config.mutationFn({ entry, title: "New title" });

    expect(apiMocks.workoutsUpdate).toHaveBeenCalledWith("workout-1", { focus: "New title" });
    expect(apiMocks.plansUpdateDayWithoutPlan).not.toHaveBeenCalled();
  });

  it("updates plan days when no workout log exists", async () => {
    const { config } = renderMutation();
    const entry = makeEntry({ workoutLogId: null, planDayId: "day-1", status: "planned" });

    await config.mutationFn({ entry, title: "Planned title" });

    expect(apiMocks.plansUpdateDayWithoutPlan).toHaveBeenCalledWith("day-1", {
      focus: "Planned title",
    });
    expect(apiMocks.workoutsUpdate).not.toHaveBeenCalled();
  });

  it("optimistically updates timeline, workout detail, and open surface state", async () => {
    const entry = makeEntry();
    const other = makeEntry({ id: "entry-2", workoutLogId: "workout-2", planDayId: "day-2", focus: "Other" });
    const timeline = [entry, other];
    const workout = { id: "workout-1", focus: "Old title" };
    queryClientMocks.getQueryData.mockReturnValue(workout);
    const { config, setters } = renderMutation(makeSetters(entry));

    await act(async () => {
      await config.onMutate({ entry, title: "New title" });
    });

    expect(queryClientMocks.cancelQueries).toHaveBeenCalledWith({ queryKey: QUERY_KEYS.timeline });
    const timelineUpdater = queryClientMocks.setQueriesData.mock.calls[0]?.[1] as
      | ((entries: TimelineEntry[]) => TimelineEntry[])
      | undefined;
    expect(timelineUpdater?.(timeline)).toEqual([
      { ...entry, focus: "New title" },
      other,
    ]);
    const workoutUpdater = queryClientMocks.setQueryData.mock.calls[0]?.[1] as
      | ((current: typeof workout) => typeof workout)
      | undefined;
    expect(workoutUpdater?.(workout)).toEqual({ ...workout, focus: "New title" });
    expect(setters.getReviewEntry()?.focus).toBe("New title");
  });

  it("rolls back only entries still showing the failed optimistic title", async () => {
    const entry = makeEntry();
    const other = makeEntry({
      id: "entry-2",
      workoutLogId: "workout-2",
      planDayId: "day-2",
      focus: "Other renamed",
    });
    const workout = { id: "workout-1", focus: "Old title" };
    queryClientMocks.getQueryData.mockReturnValue(workout);
    const { config, setters } = renderMutation(makeSetters(entry));

    let context: RenameContext | undefined;
    await act(async () => {
      context = await config.onMutate({ entry, title: "New title" });
    });
    queryClientMocks.setQueriesData.mockClear();
    queryClientMocks.setQueryData.mockClear();
    act(() => {
      config.onError(new Error("save failed"), { entry, title: "New title" }, context);
    });

    const rollbackTimeline = queryClientMocks.setQueriesData.mock.calls[0]?.[1] as
      | ((entries: TimelineEntry[]) => TimelineEntry[])
      | undefined;
    expect(rollbackTimeline?.([{ ...entry, focus: "New title" }, other])).toEqual([
      entry,
      other,
    ]);
    expect(rollbackTimeline?.([{ ...entry, focus: "Later title" }, other])).toEqual([
      { ...entry, focus: "Later title" },
      other,
    ]);

    const rollbackWorkout = queryClientMocks.setQueryData.mock.calls[0]?.[1] as
      | ((current: typeof workout) => typeof workout)
      | undefined;
    expect(rollbackWorkout?.({ ...workout, focus: "New title" })).toEqual(workout);
    expect(rollbackWorkout?.({ ...workout, focus: "Later title" })).toEqual({
      ...workout,
      focus: "Later title",
    });
    expect(setters.getReviewEntry()?.focus).toBe("Old title");
  });

  it("tracks pending renames per entry while multiple saves are in flight", async () => {
    const entryA = makeEntry();
    const entryB = makeEntry({
      id: "entry-2",
      workoutLogId: "workout-2",
      planDayId: "day-2",
      focus: "Second old title",
    });
    const { config, result } = renderMutation();

    let contextA: RenameContext | undefined;
    let contextB: RenameContext | undefined;
    await act(async () => {
      contextA = await config.onMutate({ entry: entryA, title: "First new title" });
      contextB = await config.onMutate({ entry: entryB, title: "Second new title" });
    });

    expect(result.current.isRenamingEntry(entryA)).toBe(true);
    expect(result.current.isRenamingEntry(entryB)).toBe(true);

    act(() => {
      config.onSettled(undefined, null, { entry: entryA, title: "First new title" }, contextA);
    });

    expect(result.current.isRenamingEntry(entryA)).toBe(false);
    expect(result.current.isRenamingEntry(entryB)).toBe(true);

    act(() => {
      config.onSettled(undefined, null, { entry: entryB, title: "Second new title" }, contextB);
    });

    expect(result.current.isRenamingEntry(entryA)).toBe(false);
    expect(result.current.isRenamingEntry(entryB)).toBe(false);
  });
});

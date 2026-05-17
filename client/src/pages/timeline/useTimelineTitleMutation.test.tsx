import type { TimelineEntry } from "@shared/schema";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QUERY_KEYS } from "@/lib/api";

import { useTimelineTitleMutation } from "./useTimelineTitleMutation";

const apiMocks = vi.hoisted(() => ({
  plansUpdateDayWithoutPlan: vi.fn(),
  workoutsUpdate: vi.fn(),
}));

const queryClientMocks = vi.hoisted(() => ({
  cancelQueries: vi.fn(),
  getQueriesData: vi.fn(),
  getQueryData: vi.fn(),
  setQueriesData: vi.fn(),
  setQueryData: vi.fn(),
}));

const mutationHarness = vi.hoisted(() => ({
  config: undefined as
    | {
        mutationFn: (variables: { entry: TimelineEntry; title: string }) => Promise<unknown>;
        onMutate: (variables: { entry: TimelineEntry; title: string }) => Promise<unknown>;
        onError: (
          error: Error,
          variables: { entry: TimelineEntry; title: string },
          context: unknown,
        ) => void;
      }
    | undefined,
}));

vi.mock("@/hooks/useApiMutation", () => ({
  useApiMutation: (config: unknown) => {
    mutationHarness.config = config as typeof mutationHarness.config;
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
  } as TimelineEntry;
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
  renderHook(() => useTimelineTitleMutation(setters));
  if (!mutationHarness.config) throw new Error("Expected useApiMutation config");
  return { config: mutationHarness.config, setters };
}

describe("useTimelineTitleMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationHarness.config = undefined;
    apiMocks.workoutsUpdate.mockResolvedValue({});
    apiMocks.plansUpdateDayWithoutPlan.mockResolvedValue({});
    queryClientMocks.cancelQueries.mockResolvedValue(undefined);
    queryClientMocks.getQueriesData.mockReturnValue([]);
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
    queryClientMocks.getQueriesData.mockReturnValue([[[...QUERY_KEYS.timeline, null], timeline]]);
    queryClientMocks.getQueryData.mockReturnValue(workout);
    const { config, setters } = renderMutation(makeSetters(entry));

    await config.onMutate({ entry, title: "New title" });

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

  it("rolls optimistic title updates back on error", async () => {
    const entry = makeEntry();
    const timelineKey = [...QUERY_KEYS.timeline, null];
    const timeline = [entry];
    const workout = { id: "workout-1", focus: "Old title" };
    queryClientMocks.getQueriesData.mockReturnValue([[timelineKey, timeline]]);
    queryClientMocks.getQueryData.mockReturnValue(workout);
    const { config, setters } = renderMutation(makeSetters(entry));

    const context = await config.onMutate({ entry, title: "New title" });
    queryClientMocks.setQueryData.mockClear();
    config.onError(new Error("save failed"), { entry, title: "New title" }, context);

    expect(queryClientMocks.setQueryData).toHaveBeenCalledWith(timelineKey, timeline);
    expect(queryClientMocks.setQueryData).toHaveBeenCalledWith(
      QUERY_KEYS.workout("workout-1"),
      workout,
    );
    expect(setters.getReviewEntry()?.focus).toBe("Old title");
  });
});

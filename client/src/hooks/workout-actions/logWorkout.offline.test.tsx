import type { TimelineEntry } from "@shared/schema";
import { QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeWrapper, offlineMocks, setOnline } from "@/test/support/offlineMutationHarness";

const mocks = vi.hoisted(() => ({
  createWorkout: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      workouts: { ...actual.api.workouts, create: mocks.createWorkout },
    },
  };
});
vi.mock("@/lib/offlineQueue", async () =>
  (await import("@/test/support/offlineMutationHarness")).makeOfflineQueueMock(),
);
vi.mock("@/hooks/use-toast", async () =>
  (await import("@/test/support/offlineMutationHarness")).makeOfflineToastMock(),
);

let queryClient: QueryClient;
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queryClient")>()),
  queryClient: {
    cancelQueries: (...args: unknown[]) => queryClient.cancelQueries(...(args as [never])),
    getQueryData: (...args: unknown[]) => queryClient.getQueryData(...(args as [never])),
    setQueryData: (...args: unknown[]) => queryClient.setQueryData(...(args as [never, never])),
    setQueriesData: (...args: unknown[]) => queryClient.setQueriesData(...(args as [never, never])),
    invalidateQueries: (...args: unknown[]) => queryClient.invalidateQueries(...(args as [never])),
  },
}));

import { useWorkoutActions } from "@/hooks/useWorkoutActions";
import { QUERY_KEYS } from "@/lib/api";
import { flattenTimelineCache, type TimelineCache } from "@/lib/timelineCache";

const TIMELINE_KEY = [...QUERY_KEYS.timeline, null];

function plannedEntry(): TimelineEntry {
  return {
    id: "e1",
    date: "2026-05-16",
    type: "planned",
    status: "planned",
    focus: "Legs",
    mainWorkout: "Squats",
    accessory: null,
    notes: null,
    planDayId: "pd-1",
  };
}

const QUEUED_BODY = {
  planDayId: "pd-1",
  date: "2026-05-16",
  focus: "Legs",
  mainWorkout: "Squats",
  accessory: undefined,
  notes: undefined,
  rpe: undefined,
};

const wrapper = makeWrapper(() => queryClient);

function cachedEntries(): TimelineEntry[] {
  return flattenTimelineCache(queryClient.getQueryData<TimelineCache>(TIMELINE_KEY));
}

/** Tick off the planned session the way the timeline circle and LogSheet do. */
async function markComplete(
  options: Parameters<ReturnType<typeof useWorkoutActions>["handleMarkComplete"]>[1],
) {
  const { result } = renderHook(() => useWorkoutActions(null), { wrapper });
  await act(async () => {
    result.current.handleMarkComplete(plannedEntry(), options);
    await vi.waitFor(() => {
      expect(result.current.logWorkoutMutation.isPending).toBe(false);
    });
  });
}

// CL55 (CODEBASE_ANALYSIS_2026-10-03): /log queues a workout when the
// connection fails, but ticking off a planned session from the timeline circle
// or LogSheet's "Log workout" had no fallback, so the same dropped connection
// showed "Failed to log workout".
describe("logging a planned session offline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    offlineMocks.createOfflineMutationId.mockReturnValue("queued-id");
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData<TimelineCache>(TIMELINE_KEY, {
      pages: [{ entries: [plannedEntry()], nextCursor: null }],
      pageParams: [null],
    });
    setOnline(true);
  });

  afterEach(() => setOnline(true));

  it("queues the log when the browser is offline and hands the caller onQueued", async () => {
    setOnline(false);
    const onSuccess = vi.fn();
    const onQueued = vi.fn();
    const onError = vi.fn();

    await markComplete({ onSuccess, onQueued, onError });

    expect(mocks.createWorkout).not.toHaveBeenCalled();
    expect(offlineMocks.enqueueMutation).toHaveBeenCalledWith(
      "POST",
      "/api/v1/workouts",
      QUEUED_BODY,
      { id: "queued-id" },
    );
    expect(onQueued).toHaveBeenCalledOnce();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(offlineMocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Workout queued" }),
    );
    expect(offlineMocks.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Failed to log workout" }),
    );
    // The pending-workout overlay shows the queued log; the planned row it
    // completes is not left beside it with no log behind it.
    expect(cachedEntries()).toEqual([]);
  });

  it("queues the log under the live attempt's idempotency key when the request fails in flight", async () => {
    mocks.createWorkout.mockRejectedValue(new TypeError("Failed to fetch"));
    const onQueued = vi.fn();

    await markComplete({ onQueued });

    expect(mocks.createWorkout).toHaveBeenCalledWith(QUEUED_BODY, { idempotencyKey: "queued-id" });
    expect(offlineMocks.enqueueMutation).toHaveBeenCalledWith(
      "POST",
      "/api/v1/workouts",
      QUEUED_BODY,
      { id: "queued-id" },
    );
    expect(onQueued).toHaveBeenCalledOnce();
  });

  it("still reports a server rejection as a failure", async () => {
    mocks.createWorkout.mockRejectedValue(new Error('400: {"error":"Invalid"}'));
    const onQueued = vi.fn();
    const onError = vi.fn();

    await markComplete({ onQueued, onError });

    expect(offlineMocks.enqueueMutation).not.toHaveBeenCalled();
    expect(onQueued).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    // The optimistic completed flip is rolled back.
    expect(cachedEntries()[0]?.status).toBe("planned");
  });

  it("saves online and hands back the logged entry", async () => {
    mocks.createWorkout.mockResolvedValue({
      id: "w-1",
      date: "2026-05-16",
      planDayId: "pd-1",
      focus: "Legs",
    });
    const onSuccess = vi.fn();
    const onQueued = vi.fn();

    await markComplete({ onSuccess, onQueued });

    expect(offlineMocks.enqueueMutation).not.toHaveBeenCalled();
    expect(onQueued).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: "log-w-1", workoutLogId: "w-1", status: "completed" }),
    );
    expect(offlineMocks.toast).toHaveBeenCalledWith({ title: "Workout logged!" });
  });
});

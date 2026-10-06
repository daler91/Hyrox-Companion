import type { TimelineEntry } from "@shared/schema";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkoutReparseTools } from "@/components/settings/data-tools/useWorkoutReparseTools";
import { useCombineWorkouts } from "@/hooks/useCombineWorkouts";
import { useDeviceLinkMutations } from "@/hooks/useDeviceLinkMutations";
import { useGarminMutations } from "@/hooks/useGarminMutations";
import { useMoveTimelineEntry } from "@/hooks/useMoveTimelineEntry";
import { useStravaMutations } from "@/hooks/useStravaMutations";
import { QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

const apiMocks = vi.hoisted(() => ({
  updateWorkout: vi.fn(),
  updateDayWithoutPlan: vi.fn(),
  batchReparse: vi.fn(),
  combine: vi.fn(),
  linkDeviceActivity: vi.fn(),
  stravaSync: vi.fn(),
  garminSync: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      workouts: {
        ...actual.api.workouts,
        update: apiMocks.updateWorkout,
        batchReparse: apiMocks.batchReparse,
        combine: apiMocks.combine,
        linkDeviceActivity: apiMocks.linkDeviceActivity,
      },
      plans: { ...actual.api.plans, updateDayWithoutPlan: apiMocks.updateDayWithoutPlan },
      strava: { ...actual.api.strava, sync: apiMocks.stravaSync },
      garmin: { ...actual.api.garmin, sync: apiMocks.garminSync },
    },
  };
});
vi.mock("@/lib/queryClient", async (importOriginal) =>
  (await import("@/test/support/workoutDetailHookMocks")).makeRealQueryClientMock(importOriginal),
);
vi.mock("@/hooks/use-toast", async () =>
  (await import("@/test/support/mutationHookMocks")).makeToastMock(),
);

const SQUAT_HISTORY = QUERY_KEYS.exerciseHistory("back_squat", 3);
const ROW_HISTORY = QUERY_KEYS.exerciseHistory("ski_erg", 3);
const DAY_SUMMARY = QUERY_KEYS.nutritionDay("2026-09-15");

const LOGGED = {
  id: "log-w1",
  workoutLogId: "w1",
  planDayId: null,
  date: "2026-09-15",
  type: "logged",
  status: "completed",
} as TimelineEntry;

const PLANNED = {
  id: "plan-pd-1",
  workoutLogId: null,
  planDayId: "pd-1",
  date: "2026-09-15",
  type: "planned",
  status: "planned",
} as TimelineEntry;

const isInvalidated = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function expectHistoryStale(stale: boolean) {
  expect(isInvalidated(SQUAT_HISTORY)).toBe(stale);
  expect(isInvalidated(ROW_HISTORY)).toBe(stale);
}

function moveTo(entry: TimelineEntry, newDate: string) {
  const { result } = renderHook(() => useMoveTimelineEntry(null), { wrapper });
  act(() => {
    result.current.moveEntry(entry, newDate);
  });
}

// CL43 (CODEBASE_ANALYSIS_2026-10-03): the "Last time" line and its next
// target are built from each exercise's three most recent sessions, ordered by
// workout date. These writes change those sessions outside the workout and set
// mutations, and left the history cached for its ten-minute staleTime.
describe("other workout writes refresh every exercise's history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    queryClient.setQueryData(DAY_SUMMARY, {});
    queryClient.setQueryData(SQUAT_HISTORY, []);
    queryClient.setQueryData(ROW_HISTORY, []);
  });

  it("moving a logged workout to another date", async () => {
    apiMocks.updateWorkout.mockResolvedValue({ id: "w1" });

    moveTo(LOGGED, "2026-09-12");

    await waitFor(() => {
      expectHistoryStale(true);
    });
    expect(apiMocks.updateWorkout).toHaveBeenCalledWith("w1", { date: "2026-09-12" });
  });

  // A plan day with no log has no sets in anyone's history.
  it("moving a planned day leaves the history cached", async () => {
    apiMocks.updateDayWithoutPlan.mockResolvedValue({ id: "pd-1" });

    moveTo(PLANNED, "2026-09-16");

    // The day summaries are what this move refreshes; once they are stale the
    // move's invalidation has run.
    await waitFor(() => {
      expect(isInvalidated(DAY_SUMMARY)).toBe(true);
    });
    expectHistoryStale(false);
  });

  it("batch-parsing old free-text workouts into sets", async () => {
    apiMocks.batchReparse.mockResolvedValue({ parsed: 2, failed: 0, total: 2 });
    const { result } = renderHook(() => useWorkoutReparseTools(), { wrapper });

    await act(async () => {
      await result.current.batchReparseMutation.mutateAsync();
    });

    expectHistoryStale(true);
  });

  it("combining two workouts, which re-parents their sets onto a new id", async () => {
    queryClient.setQueryData(QUERY_KEYS.recycleBin, { items: [] });
    apiMocks.combine.mockResolvedValue({ id: "w3" });
    const { result } = renderHook(() => useCombineWorkouts(), { wrapper });

    await act(async () => {
      await result.current.combineWorkoutsMutation.mutateAsync({
        newWorkout: { date: "2026-09-15", focus: "Combined", mainWorkout: "Squat + ski" },
        entriesToDelete: [LOGGED, { ...LOGGED, id: "log-w2", workoutLogId: "w2" }],
      });
    });

    expectHistoryStale(true);
    // CL50: a device-imported source goes to the recycle bin before the delete.
    expect(isInvalidated(QUERY_KEYS.recycleBin)).toBe(true);
    expect(apiMocks.combine).toHaveBeenCalledWith({
      newWorkout: { date: "2026-09-15", focus: "Combined", mainWorkout: "Squat + ski" },
      deleteWorkoutIds: ["w1", "w2"],
      skipPlanDayIds: undefined,
    });
  });

  // A device import is a logged session with a recorded set (a run, a row).
  it("syncing Strava, which imports recordings", async () => {
    apiMocks.stravaSync.mockResolvedValue({ imported: 1, skipped: 0, hasMore: false });
    const { result } = renderHook(() => useStravaMutations(), { wrapper });

    await act(async () => {
      await result.current.syncStravaMutation.mutateAsync();
    });

    expectHistoryStale(true);
  });

  it("syncing Garmin, which imports recordings", async () => {
    apiMocks.garminSync.mockResolvedValue({ imported: 1, skipped: 0 });
    const { result } = renderHook(() => useGarminMutations(), { wrapper });

    await act(async () => {
      await result.current.syncGarminMutation.mutateAsync();
    });

    expectHistoryStale(true);
  });

  it("linking a recording to another workout, which moves its set", async () => {
    apiMocks.linkDeviceActivity.mockResolvedValue({ id: "w1" });
    const { result } = renderHook(() => useDeviceLinkMutations(), { wrapper });

    await act(async () => {
      await result.current.linkMutation.mutateAsync({
        workoutLogId: "w2",
        target: { workoutLogId: "w1" },
        targetLabel: "Tempo run",
      });
    });

    expectHistoryStale(true);
  });
});

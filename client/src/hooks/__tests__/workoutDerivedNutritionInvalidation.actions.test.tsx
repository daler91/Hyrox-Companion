import type { TimelineEntry } from "@shared/schema";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGarminMutations } from "@/hooks/useGarminMutations";
import { useStravaMutations } from "@/hooks/useStravaMutations";
import { useWorkoutActionMutations } from "@/hooks/workout-actions/useWorkoutActionMutations";
import { QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

const apiMocks = vi.hoisted(() => ({
  createWorkout: vi.fn(),
  deleteWorkout: vi.fn(),
  bulkDelete: vi.fn(),
  updateDayStatus: vi.fn(),
  deleteDay: vi.fn(),
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
        create: apiMocks.createWorkout,
        delete: apiMocks.deleteWorkout,
        bulkDelete: apiMocks.bulkDelete,
      },
      plans: {
        ...actual.api.plans,
        updateDayStatus: apiMocks.updateDayStatus,
        deleteDay: apiMocks.deleteDay,
      },
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

const SESSION = QUERY_KEYS.nutritionSessionFuelling("w1");
const DAY = QUERY_KEYS.nutritionDay("2026-09-15");
const RANGE = QUERY_KEYS.nutritionRange("2026-09-09", "2026-09-15");
const BLOCK = QUERY_KEYS.nutritionBlock("2026-08-17", "2026-09-15");
const MICROS = QUERY_KEYS.nutritionMicros("2026-09-15");
/** The reads built from a workout: its fuelling, the day, the chips, the block. */
const WORKOUT_DERIVED = [SESSION, DAY, RANGE, BLOCK];
/** Built from logged food and the target alone. */
const FOOD_ONLY = [MICROS, QUERY_KEYS.nutritionTargets];

const LOGGED: TimelineEntry = {
  id: "log-w1",
  workoutLogId: "w1",
  planDayId: "pd-1",
  date: "2026-09-15",
  type: "logged",
  status: "completed",
} as TimelineEntry;

const isInvalidated = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function expectOnlyWorkoutDerivedStale() {
  for (const key of WORKOUT_DERIVED) expect(isInvalidated(key)).toBe(true);
  for (const key of FOOD_ONLY) expect(isInvalidated(key)).toBe(false);
}

type ActionMutations = ReturnType<typeof useWorkoutActionMutations>;

async function runAction(run: (m: ActionMutations) => Promise<unknown>): Promise<void> {
  const { result } = renderHook(() => useWorkoutActionMutations(null), { wrapper });
  await act(async () => {
    await run(result.current);
  });
}

// CL19 (CODEBASE_ANALYSIS_2026-10-03): each of these writes creates, changes
// or removes a logged workout, whose date, start time, duration, RPE, load and
// calories the session's fuelling, the day summary, the Timeline chips and the
// Analytics -> Fuelling block read. They refreshed the timeline and analytics
// but left those on their old figures for their staleTime.
describe("Timeline and device-sync writes refresh the nutrition reads built from the workout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    for (const key of [...WORKOUT_DERIVED, ...FOOD_ONLY]) queryClient.setQueryData(key, {});
  });

  it("logging a planned session marks them stale", async () => {
    apiMocks.createWorkout.mockResolvedValue({ id: "w2", date: "2026-09-15", planDayId: "pd-1" });

    await runAction((m) =>
      m.logWorkoutMutation.mutateAsync({
        planDayId: "pd-1",
        date: "2026-09-15",
        focus: "Run",
        mainWorkout: "5k",
      }),
    );

    expectOnlyWorkoutDerivedStale();
  });

  it("deleting a workout marks them stale", async () => {
    apiMocks.deleteWorkout.mockResolvedValue({ success: true, recycleBinItemId: "bin-1" });

    await runAction((m) => m.deleteWorkoutMutation.mutateAsync("w1"));

    expectOnlyWorkoutDerivedStale();
  });

  it("bulk deleting workouts marks them stale", async () => {
    apiMocks.bulkDelete.mockResolvedValue({
      success: true,
      batchId: "batch-1",
      deletedWorkoutLogIds: ["w1"],
      deletedPlanDayIds: [],
      deletedCount: 1,
    });

    await runAction((m) => m.bulkDeleteWorkoutMutation.mutateAsync([LOGGED]));

    expectOnlyWorkoutDerivedStale();
  });

  // A skip takes the day's meal targets off the planned session; reopening a
  // completed day deletes its log, with the log's load and calories.
  it("changing a planned day's status marks them stale", async () => {
    apiMocks.updateDayStatus.mockResolvedValue({ id: "pd-1", status: "planned" });

    await runAction((m) =>
      m.updateStatusMutation.mutateAsync({ dayId: "pd-1", status: "planned" }),
    );

    expectOnlyWorkoutDerivedStale();
  });

  // Logs keep their data when their plan day goes; only the day summary's
  // planned-session fallback reads a plan day.
  it("deleting a planned day marks only the day summaries stale", async () => {
    apiMocks.deleteDay.mockResolvedValue({ success: true, recycleBinItemId: "bin-2" });

    await runAction((m) => m.deletePlanDayMutation.mutateAsync("pd-1"));

    expect(isInvalidated(DAY)).toBe(true);
    for (const key of [SESSION, RANGE, BLOCK, ...FOOD_ONLY]) expect(isInvalidated(key)).toBe(false);
  });

  // A Strava sync imports activities and adds a recording's start time,
  // duration and calories to a workout already logged; a Garmin sync imports.
  it("a Strava sync marks them stale", async () => {
    apiMocks.stravaSync.mockResolvedValue({ imported: 1, skipped: 0, hasMore: false, enriched: 1 });
    const { result } = renderHook(() => useStravaMutations(), { wrapper });

    await act(async () => {
      await result.current.syncStravaMutation.mutateAsync();
    });

    expectOnlyWorkoutDerivedStale();
  });

  it("a Garmin sync marks them stale", async () => {
    apiMocks.garminSync.mockResolvedValue({ imported: 2, skipped: 0 });
    const { result } = renderHook(() => useGarminMutations(), { wrapper });

    await act(async () => {
      await result.current.syncGarminMutation.mutateAsync();
    });

    expectOnlyWorkoutDerivedStale();
  });
});

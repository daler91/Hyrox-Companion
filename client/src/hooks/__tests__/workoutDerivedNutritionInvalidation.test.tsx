import type { TimelineEntry } from "@shared/schema";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDeviceLinkMutations } from "@/hooks/useDeviceLinkMutations";
import { useMoveTimelineEntry } from "@/hooks/useMoveTimelineEntry";
import { QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { invalidateWorkoutWriteQueries } from "@/lib/workoutInvalidation";

const apiMocks = vi.hoisted(() => ({
  linkDeviceActivity: vi.fn(),
  unlinkDeviceActivity: vi.fn(),
  dismissDeviceLinkSuggestion: vi.fn(),
  updateWorkout: vi.fn(),
  updateDayWithoutPlan: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      workouts: {
        ...actual.api.workouts,
        linkDeviceActivity: apiMocks.linkDeviceActivity,
        unlinkDeviceActivity: apiMocks.unlinkDeviceActivity,
        dismissDeviceLinkSuggestion: apiMocks.dismissDeviceLinkSuggestion,
        update: apiMocks.updateWorkout,
      },
      plans: { ...actual.api.plans, updateDayWithoutPlan: apiMocks.updateDayWithoutPlan },
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

const isInvalidated = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function expectOnlyWorkoutDerivedStale() {
  for (const key of WORKOUT_DERIVED) expect(isInvalidated(key)).toBe(true);
  for (const key of FOOD_ONLY) expect(isInvalidated(key)).toBe(false);
}

// CL19 (CODEBASE_ANALYSIS_2026-10-03): a session's fuelling reads the
// workout's date, start time, duration and RPE; the day summary's meal targets
// and energy balance read the day's workouts; the Timeline chips (a periodised
// target) and the Analytics -> Fuelling block read each day's training load.
// These writes left all of them, or all but session fuelling, on their old
// figures for their staleTime.
describe("workout writes refresh the nutrition reads built from the workout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    for (const key of [...WORKOUT_DERIVED, ...FOOD_ONLY]) queryClient.setQueryData(key, {});
  });

  it("invalidateWorkoutWriteQueries marks the day, the chips, the block and session fuelling stale", async () => {
    invalidateWorkoutWriteQueries();

    await waitFor(() => {
      expectOnlyWorkoutDerivedStale();
    });
  });

  // A link moves a recording's start time and duration onto the workout; an
  // unlink takes them away again.
  it.each([
    [
      "link",
      (m: ReturnType<typeof useDeviceLinkMutations>) =>
        m.linkMutation.mutateAsync({
          workoutLogId: "w1",
          target: { planDayId: "pd-1" },
          targetLabel: "Tuesday's run",
        }),
    ],
    [
      "unlink",
      (m: ReturnType<typeof useDeviceLinkMutations>) =>
        m.unlinkMutation.mutateAsync({ workoutLogId: "w1" }),
    ],
  ])("a device %s marks them stale", async (_name, run) => {
    apiMocks.linkDeviceActivity.mockResolvedValue({ id: "w1" });
    apiMocks.unlinkDeviceActivity.mockResolvedValue({ log: null, standalone: { id: "w2" } });
    const { result } = renderHook(() => useDeviceLinkMutations(), { wrapper });

    await act(async () => {
      await run(result.current);
    });

    expectOnlyWorkoutDerivedStale();
  });

  // A dismissal only hides the suggestion; the workout itself is unchanged.
  it("dismissing a link suggestion leaves them alone", async () => {
    apiMocks.dismissDeviceLinkSuggestion.mockResolvedValue({ id: "w1" });
    const { result } = renderHook(() => useDeviceLinkMutations(), { wrapper });

    await act(async () => {
      await result.current.dismissMutation.mutateAsync({ workoutLogId: "w1" });
    });

    for (const key of [...WORKOUT_DERIVED, ...FOOD_ONLY]) expect(isInvalidated(key)).toBe(false);
  });

  it("moving a logged workout marks them stale: its date moves with it", async () => {
    apiMocks.updateWorkout.mockResolvedValue({ id: "w1" });
    const entry = {
      id: "w1",
      workoutLogId: "w1",
      date: "2026-09-15",
      type: "logged",
      status: "completed",
    } as TimelineEntry;
    const { result } = renderHook(() => useMoveTimelineEntry(null), { wrapper });

    act(() => {
      result.current.moveEntry(entry, "2026-09-16");
    });

    await waitFor(() => {
      expectOnlyWorkoutDerivedStale();
    });
    expect(apiMocks.updateWorkout).toHaveBeenCalledWith("w1", { date: "2026-09-16" });
  });

  // With no log on the day, its meal targets fall back to the planned session;
  // no session fuelling, chip or block reads a plan day.
  it("moving a planned day marks only the day summaries stale", async () => {
    apiMocks.updateDayWithoutPlan.mockResolvedValue(undefined);
    const entry = {
      id: "plan-pd-1",
      planDayId: "pd-1",
      date: "2026-09-15",
      type: "planned",
      status: "planned",
    } as TimelineEntry;
    const { result } = renderHook(() => useMoveTimelineEntry(null), { wrapper });

    act(() => {
      result.current.moveEntry(entry, "2026-09-16");
    });

    await waitFor(() => {
      expect(isInvalidated(DAY)).toBe(true);
    });
    for (const key of [SESSION, RANGE, BLOCK, ...FOOD_ONLY]) expect(isInvalidated(key)).toBe(false);
  });
});

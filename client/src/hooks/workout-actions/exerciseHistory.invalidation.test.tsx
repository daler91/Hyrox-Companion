import type { TimelineEntry } from "@shared/schema";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

import { useWorkoutActionMutations } from "./useWorkoutActionMutations";

const apiMocks = vi.hoisted(() => ({
  createWorkout: vi.fn(),
  deleteWorkout: vi.fn(),
  bulkDelete: vi.fn(),
  updateDayStatus: vi.fn(),
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
      plans: { ...actual.api.plans, updateDayStatus: apiMocks.updateDayStatus },
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

const LOGGED: TimelineEntry = {
  id: "log-w1",
  workoutLogId: "w1",
  planDayId: null,
  date: "2026-09-15",
  type: "logged",
  status: "completed",
} as TimelineEntry;

const isInvalidated = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

type ActionMutations = ReturnType<typeof useWorkoutActionMutations>;

async function runAction(run: (mutations: ActionMutations) => Promise<unknown>): Promise<void> {
  const { result } = renderHook(() => useWorkoutActionMutations(null), { wrapper });
  await act(async () => {
    await run(result.current);
  });
}

function expectHistoryStale() {
  expect(isInvalidated(SQUAT_HISTORY)).toBe(true);
  expect(isInvalidated(ROW_HISTORY)).toBe(true);
}

// CL43 (CODEBASE_ANALYSIS_2026-10-03): each of these writes adds, changes or
// removes a session whose sets the "Last time" line and its next target are
// built from, and none of them refreshed that history (staleTime 10 minutes).
describe("Timeline workout writes refresh every exercise's history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    queryClient.setQueryData(SQUAT_HISTORY, []);
    queryClient.setQueryData(ROW_HISTORY, []);
  });

  it("logging a planned session", async () => {
    apiMocks.createWorkout.mockResolvedValue({ id: "w2", date: "2026-09-15", planDayId: "pd-1" });

    await runAction((mutations) =>
      mutations.logWorkoutMutation.mutateAsync({
        planDayId: "pd-1",
        date: "2026-09-15",
        focus: "Strength",
        mainWorkout: "5x5 back squat",
      }),
    );

    expectHistoryStale();
  });

  it("deleting a workout", async () => {
    apiMocks.deleteWorkout.mockResolvedValue({ success: true, recycleBinItemId: "bin-1" });

    await runAction((mutations) => mutations.deleteWorkoutMutation.mutateAsync("w1"));

    expectHistoryStale();
  });

  it("bulk deleting workouts", async () => {
    apiMocks.bulkDelete.mockResolvedValue({
      success: true,
      batchId: "batch-1",
      deletedWorkoutLogIds: ["w1"],
      deletedPlanDayIds: [],
      deletedCount: 1,
    });

    await runAction((mutations) => mutations.bulkDeleteWorkoutMutation.mutateAsync([LOGGED]));

    expectHistoryStale();
  });

  it("reopening a completed planned day, which deletes its log", async () => {
    apiMocks.updateDayStatus.mockResolvedValue({ id: "pd-1", status: "planned" });

    await runAction((mutations) =>
      mutations.updateStatusMutation.mutateAsync({ dayId: "pd-1", status: "planned" }),
    );

    expectHistoryStale();
  });

  // CL50 (CODEBASE_ANALYSIS_2026-10-03): the deleted workout is in the bin now.
  it("a delete also marks the recycle-bin list stale", async () => {
    queryClient.setQueryData(QUERY_KEYS.recycleBin, { items: [] });
    apiMocks.deleteWorkout.mockResolvedValue({ success: true, recycleBinItemId: "bin-1" });

    await runAction((mutations) => mutations.deleteWorkoutMutation.mutateAsync("w1"));

    expect(isInvalidated(QUERY_KEYS.recycleBin)).toBe(true);
  });
});

import type { StructureBlockInput } from "@shared/schema";
import { QueryClient, type QueryKey, useQuery } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeWrapper } from "@/test/support/offlineMutationHarness";

const mocks = vi.hoisted(() => ({
  createWorkout: vi.fn<(payload: unknown) => Promise<unknown>>(),
  getWorkout: vi.fn<(id: string) => Promise<unknown>>(),
  toast: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      workouts: { ...actual.api.workouts, create: mocks.createWorkout, get: mocks.getWorkout },
    },
  };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

let queryClient: QueryClient;
// The hook writes through the app's singleton client; route it to this spec's.
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queryClient")>()),
  queryClient: {
    cancelQueries: (...args: unknown[]) => queryClient.cancelQueries(...(args as [never])),
    getQueryData: (queryKey: QueryKey): unknown => queryClient.getQueryData(queryKey),
    setQueryData: (...args: unknown[]) => {
      queryClient.setQueryData(...(args as [never, never]));
    },
    setQueriesData: (...args: unknown[]) => {
      queryClient.setQueriesData(...(args as [never, never]));
    },
    invalidateQueries: (...args: unknown[]) => queryClient.invalidateQueries(...(args as [never])),
  },
}));

import { QUERY_KEYS } from "@/lib/api";

import { useWorkoutActionMutations } from "./useWorkoutActionMutations";

// The app's staleTime: a primed entry counts as fresh for five minutes.
const APP_STALE_TIME_MS = 5 * 60 * 1000;

const emomBlock: StructureBlockInput = {
  sectionType: "main",
  formatType: "emom",
  durationMinutes: 10,
  steps: [
    {
      stepNumber: 1,
      minuteIndex: 1,
      stepType: "work",
      exerciseName: "wall_balls",
      targets: { targetReps: 12 },
    },
  ],
};

const loggedWorkout = {
  id: "w-1",
  userId: "user-1",
  date: "2026-10-04",
  focus: "EMOM",
  mainWorkout: "10 min EMOM: 12 wall balls",
  accessory: null,
  notes: null,
  duration: null,
  rpe: null,
  planDayId: "pd-1",
  planId: "plan-1",
  source: "manual",
  exerciseSets: [],
};

const logAsPlanned = {
  planDayId: "pd-1",
  date: "2026-10-04",
  focus: loggedWorkout.focus,
  mainWorkout: loggedWorkout.mainWorkout,
};

const wrapper = makeWrapper(() => queryClient);

describe("logWorkoutMutation primes the workout-detail cache (CL24)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: APP_STALE_TIME_MS },
        mutations: { retry: false },
      },
    });
    // POST /workouts answers without the detail read's structure fields.
    mocks.createWorkout.mockResolvedValue(loggedWorkout);
    mocks.getWorkout.mockResolvedValue({
      ...loggedWorkout,
      structureBlocks: [emomBlock],
      suggestedRpe: 7,
    });
  });

  it("refetches the full detail when the review sheet mounts after Log as planned", async () => {
    const { result } = renderHook(() => useWorkoutActionMutations(null), { wrapper });

    await act(async () => {
      await result.current.logWorkoutMutation.mutateAsync(logAsPlanned);
    });

    // The review sheet mounts on the primed entry (as useWorkoutDetail reads it).
    const detail = renderHook(
      () =>
        useQuery({ queryKey: QUERY_KEYS.workout("w-1"), queryFn: () => mocks.getWorkout("w-1") }),
      { wrapper },
    );

    await waitFor(() => {
      expect(detail.result.current.data).toMatchObject({
        structureBlocks: [emomBlock],
        suggestedRpe: 7,
      });
    });
    expect(mocks.getWorkout).toHaveBeenCalledWith("w-1");
  });

  it("still paints the primed sets before the detail read lands", async () => {
    const { result } = renderHook(() => useWorkoutActionMutations(null), { wrapper });

    await act(async () => {
      await result.current.logWorkoutMutation.mutateAsync(logAsPlanned);
    });

    expect(queryClient.getQueryData(QUERY_KEYS.workout("w-1"))).toMatchObject({
      id: "w-1",
      exerciseSets: [],
    });
  });
});

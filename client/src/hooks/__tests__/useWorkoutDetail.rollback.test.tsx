import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkoutDetail } from "@/hooks/useWorkoutDetail";
import { QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

// Every mutation in the hook is created through useApiMutation. Replacing it
// with a passthrough that hands the config back lets each test drive one
// mutation's onMutate/onError directly — the interleaving these tests are
// about needs precise control over when the failure lands, which mutate()
// against a mocked transport can't give.
vi.mock("@/hooks/useApiMutation", () => ({
  useApiMutation: (config: unknown) => ({
    config,
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
}));

// A real QueryClient, shared with the provider below, so cache reads and
// writes behave exactly as they do in the app.
vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queryClient")>();
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    ...actual,
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      workouts: {
        ...actual.api.workouts,
        get: vi.fn().mockResolvedValue(undefined),
        history: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
});

const WORKOUT_ID = "workout-1";
const workoutKey = QUERY_KEYS.workout(WORKOUT_ID);

interface MutationConfig {
  onMutate?: (variables: never) => unknown;
  onError?: (error: Error, variables: never, context: unknown) => void;
}

/** The config the hook handed to useApiMutation for one named mutation. */
function configOf(mutation: unknown): MutationConfig {
  return (mutation as { config: MutationConfig }).config;
}

function cached() {
  return queryClient.getQueryData<Record<string, unknown>>(workoutKey)!;
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

/**
 * The workout, its sets, its title and its block scores all live in ONE cache
 * entry, and the dialog fires their PATCHes concurrently — a debounced cell
 * save is in flight while the athlete retitles the workout. A rollback that
 * restores a whole-workout snapshot therefore un-saves whatever landed while
 * the failing request was out.
 */
describe("useWorkoutDetail rollbacks are scoped to the fields each mutation writes", () => {
  beforeEach(() => {
    queryClient.clear();
    queryClient.setQueryData(workoutKey, {
      id: WORKOUT_ID,
      notes: "old note",
      accessory: "old accessory",
      focus: "Old title",
      exerciseSets: [{ id: "set-1", reps: 5 }],
    });
  });

  /** A cell save and a title edit that both succeed while another PATCH is out. */
  function concurrentSuccessLands() {
    act(() => {
      queryClient.setQueryData<Record<string, unknown>>(workoutKey, (prev) => ({
        ...prev,
        focus: "New title",
        exerciseSets: [{ id: "set-1", reps: 12 }],
      }));
    });
  }

  it("keeps a concurrently-saved set edit and title when a note save fails", async () => {
    const { result } = renderHook(() => useWorkoutDetail(WORKOUT_ID), { wrapper });
    const note = configOf(result.current.updateNote);

    const context = await note.onMutate!("new note" as never);
    concurrentSuccessLands();
    act(() => note.onError!(new Error("500"), "new note" as never, context));

    // The failed note reverts...
    expect(cached().notes).toBe("old note");
    // ...and nothing else does.
    expect(cached().focus).toBe("New title");
    expect(cached().exerciseSets).toEqual([{ id: "set-1", reps: 12 }]);
  });

  it("reverts only the prescription fields the failed patch actually wrote", async () => {
    const { result } = renderHook(() => useWorkoutDetail(WORKOUT_ID), { wrapper });
    const prescription = configOf(result.current.updatePrescription);

    // The patch touches accessory alone, so a note saved concurrently by the
    // notes field must survive its failure.
    const context = await prescription.onMutate!({ accessory: "new accessory" } as never);
    act(() => {
      queryClient.setQueryData<Record<string, unknown>>(workoutKey, (prev) => ({
        ...prev,
        notes: "note saved meanwhile",
      }));
    });
    act(() =>
      prescription.onError!(new Error("500"), { accessory: "new accessory" } as never, context),
    );

    expect(cached().accessory).toBe("old accessory");
    expect(cached().notes).toBe("note saved meanwhile");
  });

  it("keeps a concurrently-saved set edit when a plan-day link fails", async () => {
    const { result } = renderHook(() => useWorkoutDetail(WORKOUT_ID), { wrapper });
    const planDay = configOf(result.current.updatePlanDay);

    const variables = { planId: "plan-9", planDayId: "day-9" };
    const context = await planDay.onMutate!(variables as never);
    concurrentSuccessLands();
    act(() => planDay.onError!(new Error("500"), variables as never, context));

    expect(cached().planDayId).toBeUndefined();
    expect(cached().exerciseSets).toEqual([{ id: "set-1", reps: 12 }]);
  });
});

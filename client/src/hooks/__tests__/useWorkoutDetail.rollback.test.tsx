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
vi.mock("@/hooks/useApiMutation", async () =>
  (await import("@/test/support/workoutDetailHookMocks")).makeApiMutationPassthroughMock(),
);

// A real QueryClient, shared with the provider below, so cache reads and
// writes behave exactly as they do in the app.
vi.mock("@/lib/queryClient", async (importOriginal) =>
  (await import("@/test/support/workoutDetailHookMocks")).makeRealQueryClientMock(importOriginal),
);

vi.mock("@/lib/api", async (importOriginal) =>
  (await import("@/test/support/workoutDetailHookMocks")).makeWorkoutReadsApiMock(importOriginal),
);

const WORKOUT_ID = "workout-1";
const workoutKey = QUERY_KEYS.workout(WORKOUT_ID);

interface MutationConfig {
  onMutate: (variables: never) => unknown;
  onError: (error: Error, variables: never, context: unknown) => void;
}

/** The optimistic-update callbacks the hook handed to useApiMutation for one named mutation. */
function configOf(mutation: unknown): MutationConfig {
  const { onMutate, onError } = (mutation as { config: Partial<MutationConfig> }).config;
  if (!onMutate || !onError) throw new Error("the mutation has no optimistic update to roll back");
  return { onMutate, onError };
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

    const context = await note.onMutate("new note" as never);
    concurrentSuccessLands();
    act(() => {
      note.onError(new Error("500"), "new note" as never, context);
    });

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
    const context = await prescription.onMutate({ accessory: "new accessory" } as never);
    act(() => {
      queryClient.setQueryData<Record<string, unknown>>(workoutKey, (prev) => ({
        ...prev,
        notes: "note saved meanwhile",
      }));
    });
    act(() => {
      prescription.onError(new Error("500"), { accessory: "new accessory" } as never, context);
    });

    expect(cached().accessory).toBe("old accessory");
    expect(cached().notes).toBe("note saved meanwhile");
  });

  it("keeps a concurrently-saved set edit when a plan-day link fails", async () => {
    const { result } = renderHook(() => useWorkoutDetail(WORKOUT_ID), { wrapper });
    const planDay = configOf(result.current.updatePlanDay);

    const variables = { planId: "plan-9", planDayId: "day-9" };
    const context = await planDay.onMutate(variables as never);
    concurrentSuccessLands();
    act(() => {
      planDay.onError(new Error("500"), variables as never, context);
    });

    expect(cached().planDayId).toBeUndefined();
    expect(cached().exerciseSets).toEqual([{ id: "set-1", reps: 12 }]);
  });
});

/**
 * A set PATCH or delete that fails rolled back by restoring the whole cached
 * workout as it was when the write started, so an RPE, a title or another set
 * saved in the meantime reverted on screen. CL52 (CODEBASE_ANALYSIS_2026-10-03)
 */
describe("useWorkoutDetail set rollbacks put back only the failed set", () => {
  beforeEach(() => {
    queryClient.clear();
    queryClient.setQueryData(workoutKey, {
      id: WORKOUT_ID,
      rpe: 6,
      focus: "Old title",
      exerciseSets: [
        { id: "set-1", reps: 5, version: 1 },
        { id: "set-2", reps: 8, version: 1 },
      ],
    });
  });

  /** An RPE, a title, another set's PATCH and a new set, all landing while a write is out. */
  function concurrentWritesLand() {
    act(() => {
      queryClient.setQueryData<Record<string, unknown>>(workoutKey, (prev) => ({
        ...prev,
        rpe: 9,
        focus: "New title",
        exerciseSets: [
          ...(prev?.exerciseSets as Record<string, unknown>[]).map((row) =>
            row.id === "set-2" ? { id: "set-2", reps: 12, version: 2 } : row,
          ),
          { id: "set-3", reps: 3, version: 1 },
        ],
      }));
    });
  }

  it("reverts the failed set's edit and keeps everything saved meanwhile", async () => {
    const { result } = renderHook(() => useWorkoutDetail(WORKOUT_ID), { wrapper });
    const updateSet = configOf(result.current.updateSet);
    const variables = { setId: "set-1", data: { reps: 10 } };

    const context = await act(() => updateSet.onMutate(variables as never));
    expect(cached().exerciseSets).toContainEqual(
      expect.objectContaining({ id: "set-1", reps: 10 }),
    );
    concurrentWritesLand();
    act(() => {
      updateSet.onError(new Error("500"), variables as never, context);
    });

    expect(cached().exerciseSets).toEqual([
      expect.objectContaining({ id: "set-1", reps: 5 }),
      { id: "set-2", reps: 12, version: 2 },
      { id: "set-3", reps: 3, version: 1 },
    ]);
    expect(cached().rpe).toBe(9);
    expect(cached().focus).toBe("New title");
  });

  it("puts a set whose delete failed back without reverting the title", async () => {
    const { result } = renderHook(() => useWorkoutDetail(WORKOUT_ID), { wrapper });
    const deleteSet = configOf(result.current.deleteSet);

    const context = await act(() => deleteSet.onMutate("set-1" as never));
    expect(cached().exerciseSets).toEqual([{ id: "set-2", reps: 8, version: 1 }]);
    concurrentWritesLand();
    act(() => {
      deleteSet.onError(new Error("500"), "set-1" as never, context);
    });

    expect(cached().exerciseSets).toEqual([
      { id: "set-1", reps: 5, version: 1 },
      { id: "set-2", reps: 12, version: 2 },
      { id: "set-3", reps: 3, version: 1 },
    ]);
    expect(cached().focus).toBe("New title");
    expect(cached().rpe).toBe(9);
  });
});

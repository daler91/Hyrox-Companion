import type { ExerciseSet } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient as appQueryClient } from "@/lib/queryClient";
import { makeExerciseSet } from "@/test/factories/exerciseSetFactory";

import { useExerciseSetsForOwner } from "../useExerciseSetsForOwner";
import type { SaveSetOrderRequest } from "../useSetOrderSave";

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/hooks/useUnitPreferences", () => ({
  useUnitPreferences: () => ({ weightUnit: "kg", distanceUnit: "km" }),
}));

const OWNER_ID = "day-1";
const SETS_KEY = ["/api/v1/plans/days", OWNER_ID, "sets"] as const;

const invalidateSpy = vi.spyOn(appQueryClient, "invalidateQueries");

type Snapshot = { exerciseSets: ExerciseSet[] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const SQUAT = makeExerciseSet({ id: "squat", sortOrder: 0, version: 3 });
// A cell edit still waiting to save: its optimistic value must survive the reorder.
const BENCH = makeExerciseSet({ id: "bench", sortOrder: 1, reps: 12, version: 5 });

/** An in-memory stand-in for the owner's cached sets, as usePlanDayExercises keeps them. */
function createHarness(saveSetOrderRequest?: SaveSetOrderRequest) {
  let cached: Snapshot = { exerciseSets: [SQUAT, BENCH] };
  const onWriteSuccess = vi.fn();
  const params = {
    ownerId: OWNER_ID,
    mutationKeyFamily: (id: string) => ["plan-day-sets", id] as const,
    setsQueryKey: (id: string) => ["/api/v1/plans/days", id, "sets"] as const,
    patchCachedSets: (_ownerId: string, updater: (sets: ExerciseSet[]) => ExerciseSet[]) => {
      cached = { exerciseSets: updater(cached.exerciseSets) };
    },
    getSnapshot: () => cached,
    restoreSnapshot: (_ownerId: string, snapshot: Snapshot) => {
      cached = snapshot;
    },
    updateSetRequest: vi.fn(),
    addSetRequest: vi.fn(),
    deleteSetRequest: vi.fn(),
    saveSetOrderRequest,
    onWriteSuccess,
    cellSaveDebounceMs: 10,
  };
  return {
    params,
    onWriteSuccess,
    idsInOrder: () =>
      [...cached.exerciseSets]
        .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
        .map((set) => set.id),
    setById: (id: string) => cached.exerciseSets.find((set) => set.id === id),
  };
}

function renderOwnerHook(params: ReturnType<typeof createHarness>["params"]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useExerciseSetsForOwner<Snapshot>(params), { wrapper });
}

// PF5 (CODEBASE_ANALYSIS_2026-10-03): a drag sent one debounced PATCH per moved
// set. Its one-request replacement has to stay one of the owner's set writes:
// counted by isSaving, marked on the save pill, and waited for by the flush
// "Complete workout" runs before the plan day is copied.
describe("useExerciseSetsForOwner drag-to-reorder save", () => {
  beforeEach(() => {
    mocks.toast.mockClear();
    invalidateSpy.mockClear();
  });

  it("offers no order save for an owner without the route", () => {
    const harness = createHarness();
    const { result } = renderOwnerHook(harness.params);

    expect(result.current.saveSetOrder).toBeUndefined();
  });

  it("shows the new order at once, saves it in one request, and counts as a set write", async () => {
    const request = deferred<ExerciseSet[]>();
    const saveSetOrderRequest = vi.fn<SaveSetOrderRequest>(() => request.promise);
    const harness = createHarness(saveSetOrderRequest);
    const { result } = renderOwnerHook(harness.params);

    act(() => {
      result.current.saveSetOrder?.(["bench", "squat"]);
    });

    // No snap back to the old order while the request is out.
    await waitFor(() => expect(harness.idsInOrder()).toEqual(["bench", "squat"]));
    expect(saveSetOrderRequest).toHaveBeenCalledTimes(1);
    expect(saveSetOrderRequest).toHaveBeenCalledWith(OWNER_ID, ["bench", "squat"]);
    expect(harness.setById("bench")?.reps).toBe(12);
    // The owner's isSaving sees it, so "Complete workout" reads "Saving edits…".
    await waitFor(() => expect(result.current.isSaving).toBe(true));

    await act(async () => {
      request.resolve([
        { ...BENCH, reps: 8, sortOrder: 0 },
        { ...SQUAT, sortOrder: 1 },
      ]);
      await request.promise;
    });

    await waitFor(() => expect(result.current.isSaving).toBe(false));
    expect(result.current.lastSavedAt).not.toBeNull();
    expect(harness.onWriteSuccess).toHaveBeenCalledTimes(1);
    expect(harness.idsInOrder()).toEqual(["bench", "squat"]);
    // Only positions come from the response; the waiting cell edit keeps its value.
    expect(harness.setById("bench")?.reps).toBe(12);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("makes the flush wait for an order save in flight, and resolve true once it lands", async () => {
    const request = deferred<ExerciseSet[]>();
    const harness = createHarness(() => request.promise);
    const { result } = renderOwnerHook(harness.params);

    act(() => {
      result.current.saveSetOrder?.(["bench", "squat"]);
    });
    let settled = false;
    const flush = result.current.flushPendingSetPatches().then((landed) => {
      settled = true;
      return landed;
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(settled).toBe(false);

    request.resolve([
      { ...BENCH, sortOrder: 0 },
      { ...SQUAT, sortOrder: 1 },
    ]);
    await expect(flush).resolves.toBe(true);
  });

  it("makes the flush report a failed order save, which says so, marks the pill and reloads the order", async () => {
    const request = deferred<ExerciseSet[]>();
    const harness = createHarness(() => request.promise);
    const { result } = renderOwnerHook(harness.params);

    act(() => {
      result.current.saveSetOrder?.(["bench", "squat"]);
    });
    const flush = result.current.flushPendingSetPatches();
    request.reject(new Error("500: Internal Server Error"));

    await expect(flush).resolves.toBe(false);
    await waitFor(() => expect(result.current.lastSaveErrorAt).not.toBeNull());
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive", title: "Couldn't save the new order" }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: SETS_KEY });
    expect(harness.onWriteSuccess).not.toHaveBeenCalled();
    // Settled saves are forgotten: the next flush has nothing to wait for.
    await expect(result.current.flushPendingSetPatches()).resolves.toBe(true);
  });

  it("explains a list another device changed", async () => {
    const harness = createHarness(() =>
      Promise.reject(new Error('409: {"error":"The exercise list changed.","code":"CONFLICT"}')),
    );
    const { result } = renderOwnerHook(harness.params);

    act(() => {
      result.current.saveSetOrder?.(["bench", "squat"]);
    });

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "This workout changed elsewhere",
          description: "Showing the latest order.",
        }),
      ),
    );
  });

  it("sends two quick drags one at a time, and the first response does not undo the second drag", async () => {
    const first = deferred<ExerciseSet[]>();
    const second = deferred<ExerciseSet[]>();
    const saveSetOrderRequest = vi
      .fn<SaveSetOrderRequest>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const harness = createHarness(saveSetOrderRequest);
    const { result } = renderOwnerHook(harness.params);

    act(() => {
      result.current.saveSetOrder?.(["bench", "squat"]);
      result.current.saveSetOrder?.(["squat", "bench"]);
    });
    await waitFor(() => expect(harness.idsInOrder()).toEqual(["squat", "bench"]));
    expect(saveSetOrderRequest).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve([
        { ...BENCH, sortOrder: 0 },
        { ...SQUAT, sortOrder: 1 },
      ]);
      await first.promise;
    });
    // The later drag is what the athlete sees, and it is sent next.
    await waitFor(() => expect(saveSetOrderRequest).toHaveBeenCalledTimes(2));
    expect(saveSetOrderRequest).toHaveBeenLastCalledWith(OWNER_ID, ["squat", "bench"]);
    expect(harness.idsInOrder()).toEqual(["squat", "bench"]);

    second.resolve([
      { ...SQUAT, sortOrder: 0 },
      { ...BENCH, sortOrder: 1 },
    ]);
    await expect(result.current.flushPendingSetPatches()).resolves.toBe(true);
    expect(harness.idsInOrder()).toEqual(["squat", "bench"]);
  });
});

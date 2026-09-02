import type { ExerciseSet } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PatchExerciseSetPayload } from "@/lib/api/exerciseSetMutations";
import { queryClient as appQueryClient } from "@/lib/queryClient";
import { makeExerciseSet } from "@/test/factories/exerciseSetFactory";

import { useExerciseSetsForOwner } from "../useExerciseSetsForOwner";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  preferences: { weightUnit: "kg", distanceUnit: "km" },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/hooks/useUnitPreferences", () => ({
  useUnitPreferences: () => mocks.preferences,
}));

const OWNER_ID = "log-1";
const SETS_KEY = ["/api/v1/workouts", OWNER_ID] as const;
const CONFLICT_BODY =
  '409: {"error":"Exercise set was modified by another request","code":"CONFLICT","details":{"currentVersion":4,"expectedVersion":3}}';

type Snapshot = { exerciseSets: ExerciseSet[] };
type UpdateSetRequest = (ownerId: string, setId: string, data: PatchExerciseSetPayload) => Promise<ExerciseSet>;

const invalidateSpy = vi.spyOn(appQueryClient, "invalidateQueries").mockResolvedValue(undefined);

/** An in-memory stand-in for the owner's cached sets, as useWorkoutDetail keeps them. */
function createHarness(initialSets: ExerciseSet[]) {
  let cache: Snapshot | undefined = { exerciseSets: initialSets };
  const updateSetRequest = vi.fn<UpdateSetRequest>();
  const restoreSnapshot = vi.fn((_ownerId: string, snapshot: Snapshot) => {
    cache = snapshot;
  });
  const params = {
    ownerId: OWNER_ID,
    mutationKeyFamily: (id: string) => ["owner-sets", id] as const,
    setsQueryKey: (id: string) => ["/api/v1/workouts", id] as const,
    patchCachedSets: (updater: (sets: ExerciseSet[]) => ExerciseSet[]) => {
      if (cache) cache = { exerciseSets: updater(cache.exerciseSets) };
    },
    getSnapshot: () => cache,
    restoreSnapshot,
    updateSetRequest,
    addSetRequest: vi.fn(),
    deleteSetRequest: vi.fn(),
    cellSaveDebounceMs: 10,
  };
  return {
    params,
    updateSetRequest,
    restoreSnapshot,
    setCache: (sets: ExerciseSet[]) => {
      cache = { exerciseSets: sets };
    },
    getSets: () => cache?.exerciseSets ?? [],
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useExerciseSetsForOwner optimistic lock (finding D5)", () => {
  beforeEach(() => {
    mocks.toast.mockClear();
    invalidateSpy.mockClear();
    mocks.preferences = { weightUnit: "kg", distanceUnit: "km" };
  });

  it("sends the cached row's version as expectedVersion", async () => {
    const harness = createHarness([makeExerciseSet({ id: "s1", version: 7 })]);
    harness.updateSetRequest.mockResolvedValue(makeExerciseSet({ id: "s1", weight: 70, version: 8 }));
    const { result } = renderOwnerHook(harness.params);

    await act(async () => {
      await result.current.updateSet.mutateAsync({ setId: "s1", data: { weight: 70 } });
    });

    expect(harness.updateSetRequest).toHaveBeenCalledWith(OWNER_ID, "s1", {
      weight: 70,
      expectedVersion: 7,
    });
    expect(harness.getSets()[0]).toMatchObject({ weight: 70, version: 8 });
  });

  it("sends no expectedVersion when the cached row carries none", async () => {
    const harness = createHarness([makeExerciseSet({ id: "s1", version: undefined as never })]);
    harness.updateSetRequest.mockResolvedValue(makeExerciseSet({ id: "s1", version: 2 }));
    const { result } = renderOwnerHook(harness.params);

    await act(async () => {
      await result.current.updateSet.mutateAsync({ setId: "s1", data: { reps: 6 } });
    });

    expect(harness.updateSetRequest).toHaveBeenCalledWith(OWNER_ID, "s1", { reps: 6 });
  });

  it("waits for the first response and sends its bumped version on the next edit to the same set", async () => {
    const harness = createHarness([makeExerciseSet({ id: "s1", version: 3 })]);
    const first = deferred<ExerciseSet>();
    harness.updateSetRequest
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(makeExerciseSet({ id: "s1", weight: 70, reps: 6, version: 5 }));
    const { result } = renderOwnerHook(harness.params);

    let firstEdit: Promise<ExerciseSet> | undefined;
    let secondEdit: Promise<ExerciseSet> | undefined;
    act(() => {
      firstEdit = result.current.updateSet.mutateAsync({ setId: "s1", data: { weight: 70 } });
      secondEdit = result.current.updateSet.mutateAsync({ setId: "s1", data: { reps: 6 } });
    });

    await waitFor(() => expect(harness.updateSetRequest).toHaveBeenCalledTimes(1));
    // The second PATCH must not go out while the first is in flight: it would
    // carry version 3, which the first is about to bump.
    await act(async () => {
      await Promise.resolve();
    });
    expect(harness.updateSetRequest).toHaveBeenCalledTimes(1);

    // The first response lands while a newer edit is already open, so the W13
    // guard drops it for the UI. Its version is still what the next PATCH needs.
    first.resolve(makeExerciseSet({ id: "s1", weight: 70, version: 4 }));
    await act(async () => {
      await Promise.all([firstEdit, secondEdit]);
    });

    expect(harness.updateSetRequest).toHaveBeenNthCalledWith(1, OWNER_ID, "s1", {
      weight: 70,
      expectedVersion: 3,
    });
    expect(harness.updateSetRequest).toHaveBeenNthCalledWith(2, OWNER_ID, "s1", {
      reps: 6,
      expectedVersion: 4,
    });
    expect(harness.getSets()[0]).toMatchObject({ weight: 70, reps: 6, version: 5 });
  });

  it("rolls back, refetches and explains a 409 instead of retrying over the other device", async () => {
    const harness = createHarness([makeExerciseSet({ id: "s1", weight: 60, version: 3 })]);
    harness.updateSetRequest.mockRejectedValue(new Error(CONFLICT_BODY));
    const { result } = renderOwnerHook(harness.params);

    await act(async () => {
      await expect(
        result.current.updateSet.mutateAsync({ setId: "s1", data: { weight: 70 } }),
      ).rejects.toThrow("409");
    });

    expect(harness.updateSetRequest).toHaveBeenCalledTimes(1);
    expect(harness.restoreSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.getSets()[0].weight).toBe(60);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: SETS_KEY });
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "This set was updated elsewhere",
        description: "Showing the latest values.",
      }),
    );
    expect(result.current.lastSaveErrorAt).not.toBeNull();
  });

  it("re-seeds from the refetched row after a conflict", async () => {
    const harness = createHarness([makeExerciseSet({ id: "s1", version: 3 })]);
    harness.updateSetRequest
      .mockRejectedValueOnce(new Error(CONFLICT_BODY))
      .mockResolvedValueOnce(makeExerciseSet({ id: "s1", reps: 6, version: 5 }));
    const { result } = renderOwnerHook(harness.params);

    await act(async () => {
      await result.current.updateSet
        .mutateAsync({ setId: "s1", data: { weight: 70 } })
        .catch(() => undefined);
    });
    // The refetch the conflict triggered has landed with the other device's version.
    harness.setCache([makeExerciseSet({ id: "s1", version: 4 })]);

    await act(async () => {
      await result.current.updateSet.mutateAsync({ setId: "s1", data: { reps: 6 } });
    });

    expect(harness.updateSetRequest).toHaveBeenNthCalledWith(2, OWNER_ID, "s1", {
      reps: 6,
      expectedVersion: 4,
    });
  });

  it("drops an edit queued behind a conflicting one rather than sending it blind", async () => {
    const harness = createHarness([makeExerciseSet({ id: "s1", version: 3 })]);
    const first = deferred<ExerciseSet>();
    harness.updateSetRequest.mockReturnValueOnce(first.promise);
    const { result } = renderOwnerHook(harness.params);

    let firstEdit: Promise<ExerciseSet> | undefined;
    let secondEdit: Promise<ExerciseSet> | undefined;
    act(() => {
      firstEdit = result.current.updateSet.mutateAsync({ setId: "s1", data: { weight: 70 } });
      secondEdit = result.current.updateSet.mutateAsync({ setId: "s1", data: { reps: 6 } });
    });
    await waitFor(() => expect(harness.updateSetRequest).toHaveBeenCalledTimes(1));

    first.reject(new Error(CONFLICT_BODY));
    await act(async () => {
      await expect(firstEdit).rejects.toThrow("409");
      await expect(secondEdit).rejects.toThrow("updated elsewhere");
    });

    expect(harness.updateSetRequest).toHaveBeenCalledTimes(1);
    // The dropped edit rolls its own value back; the refetch the conflict
    // requested is what replaces the whole row with the other device's.
    expect(harness.getSets()[0].reps).toBe(8);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: SETS_KEY });
  });

  it("keeps the generic save error for anything that is not a conflict", async () => {
    const harness = createHarness([makeExerciseSet({ id: "s1", weight: 60, version: 3 })]);
    harness.updateSetRequest.mockRejectedValue(new Error("500: Internal Server Error"));
    const { result } = renderOwnerHook(harness.params);

    await act(async () => {
      await expect(
        result.current.updateSet.mutateAsync({ setId: "s1", data: { weight: 70 } }),
      ).rejects.toThrow("500");
    });

    expect(harness.getSets()[0].weight).toBe(60);
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't save that change" }),
    );
  });

  it("re-stamps the optimistic row so the display conversion shows the typed number (D2 + D5)", async () => {
    mocks.preferences = { weightUnit: "lbs", distanceUnit: "miles" };
    const harness = createHarness([
      makeExerciseSet({ id: "s1", weight: 100, plannedWeight: 90, weightUnit: "kg", version: 3 }),
    ]);
    const pending = deferred<ExerciseSet>();
    harness.updateSetRequest.mockReturnValueOnce(pending.promise);
    const { result } = renderOwnerHook(harness.params);

    let edit: Promise<ExerciseSet> | undefined;
    act(() => {
      edit = result.current.updateSet.mutateAsync({ setId: "s1", data: { weight: 230 } });
    });
    await waitFor(() => expect(harness.updateSetRequest).toHaveBeenCalledTimes(1));

    // Spread raw, the row would read weight 230 stamped kg: the display
    // conversion would then show 507 lb until the server row arrived.
    expect(harness.getSets()[0]).toMatchObject({ weight: 230, weightUnit: "lbs", plannedWeight: 198 });

    pending.resolve(makeExerciseSet({ id: "s1", weight: 230, plannedWeight: 198, weightUnit: "lbs", version: 4 }));
    await act(async () => {
      await edit;
    });
  });

  it("carries the lock on the unmount flush of a debounced edit", async () => {
    const harness = createHarness([makeExerciseSet({ id: "s1", version: 7 })]);
    harness.updateSetRequest.mockResolvedValue(makeExerciseSet({ id: "s1", weight: 75, version: 8 }));
    const { result, unmount } = renderOwnerHook(harness.params);

    act(() => {
      result.current.patchSetDebounced("s1", { weight: 75 });
    });
    expect(harness.updateSetRequest).not.toHaveBeenCalled();

    unmount();

    await waitFor(() =>
      expect(harness.updateSetRequest).toHaveBeenCalledWith(OWNER_ID, "s1", {
        weight: 75,
        expectedVersion: 7,
      }),
    );
  });
});

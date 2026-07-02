import { beforeEach, describe, expect, it, vi } from "vitest";

import { invalidateForSyncedRequests } from "./offlineInvalidation";

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  invalidateWorkoutWriteQueries: vi.fn(),
}));

vi.mock("@/lib/queryClient", () => ({
  queryClient: { invalidateQueries: mocks.invalidateQueries.mockResolvedValue(undefined) },
}));
vi.mock("./workoutInvalidation", () => ({
  invalidateWorkoutWriteQueries: mocks.invalidateWorkoutWriteQueries,
}));

function invalidatedKeys(): string[][] {
  return mocks.invalidateQueries.mock.calls.map((call) => call[0].queryKey as string[]);
}

describe("invalidateForSyncedRequests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invalidateQueries.mockResolvedValue(undefined);
  });

  it("invalidates only workout queries for a synced workout create", () => {
    invalidateForSyncedRequests([{ url: "/api/v1/workouts", method: "POST" }]);

    expect(mocks.invalidateWorkoutWriteQueries).toHaveBeenCalledOnce();
    expect(invalidatedKeys()).toEqual([]);
  });

  it("invalidates nutrition summary/recent/range for a synced nutrition log", () => {
    invalidateForSyncedRequests([{ url: "/api/v1/nutrition/logs", method: "POST" }]);

    expect(mocks.invalidateWorkoutWriteQueries).not.toHaveBeenCalled();
    expect(invalidatedKeys()).toEqual([
      ["/api/v1/nutrition/summary"],
      ["/api/v1/nutrition/foods/recent"],
      ["/api/v1/nutrition/summary-range"],
    ]);
  });

  it("invalidates both sets when a batch mixes workout and nutrition writes", () => {
    invalidateForSyncedRequests([
      { url: "/api/v1/workouts", method: "POST" },
      { url: "/api/v1/nutrition/logs", method: "POST" },
    ]);

    expect(mocks.invalidateWorkoutWriteQueries).toHaveBeenCalledOnce();
    expect(invalidatedKeys().length).toBe(3);
  });

  it("falls back to workout invalidation when no request metadata is present", () => {
    invalidateForSyncedRequests(undefined);
    expect(mocks.invalidateWorkoutWriteQueries).toHaveBeenCalledOnce();
  });

  it("treats a plan status PATCH as a workout write", () => {
    invalidateForSyncedRequests([{ url: "/api/v1/plans/days/d1/status", method: "PATCH" }]);
    expect(mocks.invalidateWorkoutWriteQueries).toHaveBeenCalledOnce();
    expect(invalidatedKeys()).toEqual([]);
  });
});

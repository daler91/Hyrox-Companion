import { type InvalidateQueryFilters, QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QUERY_KEYS } from "./api";
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

  it("invalidates every food-log read for a synced nutrition log", () => {
    invalidateForSyncedRequests([{ url: "/api/v1/nutrition/logs", method: "POST" }]);

    expect(mocks.invalidateWorkoutWriteQueries).not.toHaveBeenCalled();
    expect(invalidatedKeys()).toEqual([
      ["/api/v1/nutrition/summary"],
      ["/api/v1/nutrition/micros"],
      ["/api/v1/nutrition/summary-range"],
      // CL19 (CODEBASE_ANALYSIS_2026-10-03): Analytics -> Fuelling charts the
      // day's intake, and a workout's pre/post intake is built from its entries.
      ["/api/v1/nutrition/block"],
      ["/api/v1/nutrition/session-fuelling"],
      ["/api/v1/nutrition/foods/recent"],
    ]);
  });

  // CL19 (CODEBASE_ANALYSIS_2026-10-03): a replayed log left a workout's
  // pre/post intake on its pre-sync figure for the query's 60 s staleTime.
  it("marks a cached session's intake and the block stale in a real QueryClient", () => {
    const client = new QueryClient();
    mocks.invalidateQueries.mockImplementation((filters: InvalidateQueryFilters) =>
      client.invalidateQueries(filters),
    );
    const session = QUERY_KEYS.nutritionSessionFuelling("w1");
    const block = QUERY_KEYS.nutritionBlock("2026-08-17", "2026-09-15");
    for (const key of [session, block, QUERY_KEYS.nutritionTargets]) client.setQueryData(key, {});

    invalidateForSyncedRequests([{ url: "/api/v1/nutrition/logs", method: "POST" }]);

    expect(client.getQueryState(session)?.isInvalidated).toBe(true);
    expect(client.getQueryState(block)?.isInvalidated).toBe(true);
    expect(client.getQueryState(QUERY_KEYS.nutritionTargets)?.isInvalidated).toBe(false);
  });

  it("invalidates both sets when a batch mixes workout and nutrition writes", () => {
    invalidateForSyncedRequests([
      { url: "/api/v1/workouts", method: "POST" },
      { url: "/api/v1/nutrition/logs", method: "POST" },
    ]);

    expect(mocks.invalidateWorkoutWriteQueries).toHaveBeenCalledOnce();
    expect(invalidatedKeys()).toHaveLength(6);
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

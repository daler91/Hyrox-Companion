import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/queryClient", () => ({
  queryClient: { invalidateQueries: mocks.invalidateQueries },
}));

import { QUERY_KEYS } from "@/lib/api";

import {
  flushWorkoutWriteInvalidation,
  invalidateWorkoutWriteQueries,
  scheduleWorkoutWriteInvalidation,
  WORKOUT_WRITE_INVALIDATION_DELAY_MS,
} from "./workoutInvalidation";

/**
 * The derived-view keys a workout write moves. Six invalidations per call is
 * the contract the coalescing below is measured against.
 */
const DERIVED_KEY_COUNT = 6;

describe("workoutInvalidation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.invalidateQueries.mockClear();
  });

  afterEach(() => {
    // Never leak a pending timer into the next test.
    flushWorkoutWriteInvalidation();
    vi.useRealTimers();
  });

  it("invalidateWorkoutWriteQueries hits every derived view at once", () => {
    invalidateWorkoutWriteQueries();

    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(DERIVED_KEY_COUNT);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: QUERY_KEYS.timeline });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: QUERY_KEYS.trainingOverview });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: QUERY_KEYS.personalRecords });
  });

  it("coalesces a burst of set saves into ONE trailing invalidation", () => {
    // Twenty cell saves ~350ms apart — the rhythm of logging a session. Each
    // used to refetch the 500-entry timeline, the all-time overview and the PR
    // list immediately.
    for (let i = 0; i < 20; i++) {
      scheduleWorkoutWriteInvalidation();
      vi.advanceTimersByTime(350);
    }
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();

    vi.advanceTimersByTime(WORKOUT_WRITE_INVALIDATION_DELAY_MS);

    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(DERIVED_KEY_COUNT);
  });

  it("fires on its own once the athlete pauses for the delay", () => {
    scheduleWorkoutWriteInvalidation();
    vi.advanceTimersByTime(WORKOUT_WRITE_INVALIDATION_DELAY_MS - 1);
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(DERIVED_KEY_COUNT);
  });

  it("flush runs a pending invalidation immediately and exactly once (sheet close)", () => {
    scheduleWorkoutWriteInvalidation();
    scheduleWorkoutWriteInvalidation();

    flushWorkoutWriteInvalidation();
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(DERIVED_KEY_COUNT);

    // The timer was cleared: nothing fires again later.
    vi.advanceTimersByTime(WORKOUT_WRITE_INVALIDATION_DELAY_MS * 2);
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(DERIVED_KEY_COUNT);
  });

  it("flush is a no-op when nothing is pending", () => {
    flushWorkoutWriteInvalidation();
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });
});

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearOfflineQueue,
  enqueueMutation,
  OFFLINE_QUEUE_CHANGE_EVENT,
} from "@/lib/offlineQueue";

import { usePendingWorkoutEntries } from "./usePendingWorkoutEntries";

describe("usePendingWorkoutEntries", () => {
  beforeEach(() => {
    clearOfflineQueue();
    localStorage.clear();
  });

  afterEach(() => {
    clearOfflineQueue();
  });

  it("returns a pending entry for a queued workout create", () => {
    enqueueMutation("POST", "/api/v1/workouts", { focus: "Legs" }, { id: "w1" });

    const { result } = renderHook(() => usePendingWorkoutEntries());

    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe("pending-w1");
    expect(result.current[0].pending).toBe(true);
    expect(result.current[0].focus).toBe("Legs");
  });

  it("ignores non-workout-create queue entries", () => {
    enqueueMutation("POST", "/api/v1/nutrition/logs", { foodId: "f1" }, { id: "n1" });

    const { result } = renderHook(() => usePendingWorkoutEntries());

    expect(result.current).toHaveLength(0);
  });

  it("updates when the queue changes", () => {
    const { result } = renderHook(() => usePendingWorkoutEntries());
    expect(result.current).toHaveLength(0);

    act(() => {
      enqueueMutation("POST", "/api/v1/workouts", { focus: "Push" }, { id: "w2" });
      // enqueueMutation dispatches OFFLINE_QUEUE_CHANGE_EVENT synchronously,
      // but re-dispatch defensively in case of batching in the test env.
      globalThis.dispatchEvent(new CustomEvent(OFFLINE_QUEUE_CHANGE_EVENT, { detail: { pendingCount: 1 } }));
    });

    expect(result.current).toHaveLength(1);
    expect(result.current[0].focus).toBe("Push");
  });
});

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearOfflineQueue, enqueueMutation, getPendingCount, onMutationDropped } from "@/lib/offlineQueue";
import { apiRequest } from "@/lib/queryClient";

import { useOfflineQueueFlush } from "../useOfflineQueueFlush";

vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queryClient")>()),
  apiRequest: vi.fn(),
}));

describe("useOfflineQueueFlush", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(apiRequest).mockResolvedValue(new Response("{}"));
  });

  afterEach(() => {
    clearOfflineQueue();
    vi.useRealTimers();
  });

  it("drains the queue on mount for the signed-in athlete", async () => {
    enqueueMutation("POST", "/api/v1/workouts", { title: "Queued" }, { id: "w1" });

    renderHook(() => useOfflineQueueFlush("user-a"));
    await vi.advanceTimersByTimeAsync(0);

    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(getPendingCount()).toBe(0);
  });

  // CL27 (CODEBASE_ANALYSIS_2026-10-03): the queue now retries on a timer and on
  // focus. A sign-out without a reload must not leave those running for the
  // previous athlete, or they could replay the queue under the next one's session.
  it("stops automatic retries once the signed-in athlete is gone", async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    enqueueMutation("POST", "/api/v1/workouts", { title: "A's" }, { id: "a1" });
    const { unmount } = renderHook(() => useOfflineQueueFlush("user-a"));
    await vi.advanceTimersByTimeAsync(0);
    expect(apiRequest).toHaveBeenCalledTimes(1);

    unmount();
    globalThis.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(getPendingCount()).toBe(1);
  });

  it("drops the previous athlete's queue when a different one signs in, without replaying it", async () => {
    const dropped = vi.fn();
    const unsubscribe = onMutationDropped(dropped);
    vi.mocked(apiRequest).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    enqueueMutation("POST", "/api/v1/workouts", { title: "A's" }, { id: "a1" });
    const { rerender } = renderHook(({ userId }) => useOfflineQueueFlush(userId), {
      initialProps: { userId: "user-a" },
    });
    await vi.advanceTimersByTimeAsync(0);

    rerender({ userId: "user-b" });
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(dropped).toHaveBeenCalledWith(expect.objectContaining({ id: "a1", reason: "wrong_account" }));
    expect(getPendingCount()).toBe(0);
    unsubscribe();
  });
});

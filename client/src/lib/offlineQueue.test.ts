import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest } from "./queryClient";

vi.mock("./queryClient", () => ({
  apiRequest: vi.fn(),
}));

import {
  createOfflineMutationId,
  enqueueMutation,
  flushQueue,
  getPendingCount,
  OFFLINE_QUEUE_CHANGE_EVENT,
  OFFLINE_SYNC_COMPLETE_EVENT,
  onMutationDropped,
} from "./offlineQueue";

const STORAGE_KEY = "fitai-offline-queue";

function readStoredQueue(): Array<Record<string, unknown>> {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
}

describe("offlineQueue", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("generates replay ids with browser crypto", () => {
    const deterministicUuid = "24936253-dc1a-4fe1-a481-f33c22053e78";
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(deterministicUuid);
    const mathRandom = vi.spyOn(Math, "random");
    try {
      const id = createOfflineMutationId();

      expect(id).toBe(deterministicUuid);
      expect(randomUUID).toHaveBeenCalledOnce();
      expect(mathRandom).not.toHaveBeenCalled();
    } finally {
      randomUUID.mockRestore();
      mathRandom.mockRestore();
    }
  });

  it("uses a caller-provided id as the replay idempotency key", async () => {
    const body = { title: "Queued workout" };
    vi.mocked(apiRequest).mockResolvedValueOnce(new Response(JSON.stringify({ id: "workout-1" })));

    const id = enqueueMutation("POST", "/api/v1/workouts", body, { id: "fixed-id" });
    const result = await flushQueue();

    expect(id).toBe("fixed-id");
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/v1/workouts", body, undefined, {
      "X-Idempotency-Key": "fixed-id",
    });
    expect(result).toEqual({ synced: 1, failed: 0, dropped: 0 });
    expect(getPendingCount()).toBe(0);
  });

  it("dispatches queue-change and sync-complete events", async () => {
    const queueChange = vi.fn();
    const syncComplete = vi.fn();
    globalThis.addEventListener(OFFLINE_QUEUE_CHANGE_EVENT, queueChange);
    globalThis.addEventListener(OFFLINE_SYNC_COMPLETE_EVENT, syncComplete);
    vi.mocked(apiRequest).mockResolvedValueOnce(new Response(JSON.stringify({ id: "workout-1" })));

    enqueueMutation("POST", "/api/v1/workouts", { title: "Queued" }, { id: "event-id" });
    await flushQueue();

    expect(queueChange).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { pendingCount: 1 },
      }),
    );
    expect(syncComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { synced: 1, failed: 0, dropped: 0 },
      }),
    );

    globalThis.removeEventListener(OFFLINE_QUEUE_CHANGE_EVENT, queueChange);
    globalThis.removeEventListener(OFFLINE_SYNC_COMPLETE_EVENT, syncComplete);
  });

  it("keeps failed replay attempts with an incremented retry count", async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    enqueueMutation("POST", "/api/v1/workouts", { title: "Queued" }, { id: "retry-id" });
    const result = await flushQueue();

    expect(result).toEqual({ synced: 0, failed: 1, dropped: 0 });
    expect(getPendingCount()).toBe(1);
    expect(readStoredQueue()[0]).toMatchObject({ id: "retry-id", retryCount: 1 });
  });

  it("drops mutations that exceed the retry limit", async () => {
    const dropped = vi.fn();
    const unsubscribe = onMutationDropped(dropped);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "too-many-retries",
          method: "POST",
          url: "/api/v1/workouts",
          body: { title: "Old" },
          timestamp: Date.now(),
          retryCount: 5,
        },
      ]),
    );

    const result = await flushQueue();

    expect(result).toEqual({ synced: 0, failed: 0, dropped: 1 });
    expect(apiRequest).not.toHaveBeenCalled();
    expect(getPendingCount()).toBe(0);
    expect(dropped).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "too-many-retries",
        reason: "max_retries",
      }),
    );
    unsubscribe();
  });
});

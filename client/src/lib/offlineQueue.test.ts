import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest, RateLimitError } from "./queryClient";

vi.mock("./queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./queryClient")>()),
  apiRequest: vi.fn(),
}));

import {
  clearOfflineQueue,
  createOfflineMutationId,
  enqueueMutation,
  flushQueue,
  getPendingCount,
  getPendingMutations,
  OFFLINE_QUEUE_CHANGE_EVENT,
  OFFLINE_SYNC_COMPLETE_EVENT,
  onMutationDropped,
  reconcileQueueOwner,
  releaseQueueOwner,
} from "./offlineQueue";

const STORAGE_KEY = "fitai-offline-queue";

function readStoredQueue(): Array<Record<string, unknown>> {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
}

function setOnline(online: boolean) {
  Object.defineProperty(globalThis.navigator, "onLine", {
    value: online,
    configurable: true,
  });
}

/** The bodies apiRequest was called with, in call order. */
function sentBodies(): unknown[] {
  return vi.mocked(apiRequest).mock.calls.map(([, , body]) => body);
}

describe("offlineQueue", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Also forgets the reconciled owner and cancels any scheduled retry, so no
    // timer from one test replays into the next.
    clearOfflineQueue();
    vi.useRealTimers();
    setOnline(true);
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

  it("coalesces concurrent flushes into a single in-flight run (W12)", async () => {
    let resolveRequest!: (res: Response) => void;
    vi.mocked(apiRequest).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveRequest = resolve;
      }),
    );
    enqueueMutation("POST", "/api/v1/workouts", { title: "Queued" }, { id: "coalesce-id" });

    // Two overlapping flushes (e.g. rapid online/online events during flapping)
    // must share one run, not load the same snapshot and replay twice.
    const first = flushQueue();
    const second = flushQueue();
    expect(second).toBe(first); // same in-flight promise

    resolveRequest(new Response(JSON.stringify({ id: "workout-1" })));
    const [r1, r2] = await Promise.all([first, second]);

    expect(apiRequest).toHaveBeenCalledTimes(1); // replayed once — no double-send
    expect(r1).toEqual({ synced: 1, failed: 0, dropped: 0 });
    expect(r2).toEqual(r1);
    expect(getPendingCount()).toBe(0);
  });

  it("preserves a mutation enqueued during an active flush instead of dropping it (P2)", async () => {
    let resolveA!: (res: Response) => void;
    vi.mocked(apiRequest).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveA = resolve;
      }),
    );
    enqueueMutation("POST", "/api/v1/a", { n: "a" }, { id: "A" });
    const flush = flushQueue(); // snapshots [A], awaits A's request

    // B is enqueued AFTER doFlushQueue took its snapshot but before it saves.
    enqueueMutation("POST", "/api/v1/b", { n: "b" }, { id: "B" });

    resolveA(new Response(JSON.stringify({ id: "ok" })));
    await flush;

    // A synced and removed; B must survive the snapshot-only save so it drains
    // on the next flush rather than being silently overwritten away.
    expect(readStoredQueue().map((m) => m.id)).toEqual(["B"]);
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
        detail: {
          synced: 1,
          failed: 0,
          dropped: 0,
          syncedRequests: [{ url: "/api/v1/workouts", method: "POST" }],
        },
      }),
    );

    globalThis.removeEventListener(OFFLINE_QUEUE_CHANGE_EVENT, queueChange);
    globalThis.removeEventListener(OFFLINE_SYNC_COMPLETE_EVENT, syncComplete);
  });

  it("reports getPendingMutations for the overlay and syncedRequests per replayed url", async () => {
    enqueueMutation("POST", "/api/v1/workouts", { title: "W" }, { id: "w1" });
    enqueueMutation("POST", "/api/v1/nutrition/logs", { foodId: "f1" }, { id: "n1" });

    const pending = getPendingMutations();
    expect(pending.map((m) => m.url)).toEqual(["/api/v1/workouts", "/api/v1/nutrition/logs"]);

    const syncComplete = vi.fn();
    globalThis.addEventListener(OFFLINE_SYNC_COMPLETE_EVENT, syncComplete);
    vi.mocked(apiRequest).mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    await flushQueue();

    expect(syncComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          synced: 2,
          syncedRequests: [
            { url: "/api/v1/workouts", method: "POST" },
            { url: "/api/v1/nutrition/logs", method: "POST" },
          ],
        }),
      }),
    );
    expect(getPendingMutations()).toEqual([]);

    globalThis.removeEventListener(OFFLINE_SYNC_COMPLETE_EVENT, syncComplete);
  });

  // A body that is not JSON (a proxy's page, a bare status text) is still the
  // server's verdict (CL34, CODEBASE_ANALYSIS_2026-10-03).
  it.each([
    ["a validation error", new Error('400: {"error":"Invalid body","code":"VALIDATION_ERROR"}')],
    ["a body that is not JSON", new Error("413: Payload Too Large")],
  ])("counts a definitive rejection, %s, toward the retry limit", async (_label, error) => {
    vi.mocked(apiRequest).mockRejectedValueOnce(error);

    enqueueMutation("POST", "/api/v1/workouts", { title: "Queued" }, { id: "retry-id" });
    const result = await flushQueue();

    expect(result).toEqual({ synced: 0, failed: 1, dropped: 0 });
    expect(getPendingCount()).toBe(1);
    expect(readStoredQueue()[0]).toMatchObject({ id: "retry-id", retryCount: 1 });
  });

  // CL28 (CODEBASE_ANALYSIS_2026-10-03): every one of these failed to reach a
  // verdict on the write itself, so none of them may spend its retry budget. A
  // flaky gym connection used to drop the athlete's workout after five tries.
  it.each([
    ["a dropped connection", new TypeError("Failed to fetch")],
    ["a CSRF token fetch that failed", new Error("Failed to fetch CSRF token: 503")],
    ["an expired session", new Error('401: {"error":"Unauthorized"}')],
    ["a request timeout", new Error("408: Request Timeout")],
    ["a rate limit", new RateLimitError('{"error":"Too many requests"}', 30)],
    ["a deploy-time 503", new Error("503: Service Unavailable")],
    [
      "the original timed-out request still running",
      new Error('409: {"error":"Already being processed","code":"IDEMPOTENT_REQUEST_IN_PROGRESS"}'),
    ],
    ["a stale CSRF token", new Error('403: {"error":"invalid csrf token","code":"EBADCSRFTOKEN"}')],
  ])("keeps a queued write through repeated failures from %s (CL28)", async (_label, error) => {
    const dropped = vi.fn();
    const unsubscribe = onMutationDropped(dropped);
    vi.mocked(apiRequest).mockRejectedValue(error);
    enqueueMutation("POST", "/api/v1/workouts", { title: "Gym basement" }, { id: "flaky" });

    for (let attempt = 0; attempt < 8; attempt++) {
      expect(await flushQueue()).toEqual({ synced: 0, failed: 1, dropped: 0 });
    }

    expect(dropped).not.toHaveBeenCalled();
    expect(readStoredQueue()).toEqual([expect.objectContaining({ id: "flaky", retryCount: 0 })]);

    vi.mocked(apiRequest).mockResolvedValue(new Response("{}"));
    expect(await flushQueue()).toEqual({ synced: 1, failed: 0, dropped: 0 });
    expect(getPendingCount()).toBe(0);
    unsubscribe();
  });

  it("drops a write the server answers with a plain 500 every time, so it can't hold the queue behind it for a week", async () => {
    const dropped = vi.fn();
    const unsubscribe = onMutationDropped(dropped);
    vi.mocked(apiRequest).mockImplementation(async (_method, url) => {
      if (url === "/api/v1/workouts/bad") throw new Error('500: {"error":"Internal Server Error"}');
      return new Response("{}");
    });
    enqueueMutation("PATCH", "/api/v1/workouts/bad", { title: "Bad" }, { id: "bad" });
    enqueueMutation("POST", "/api/v1/workouts", { title: "Behind it" }, { id: "behind" });

    for (let attempt = 0; attempt < 20; attempt++) await flushQueue();
    expect(dropped).not.toHaveBeenCalled();
    expect(readStoredQueue()).toEqual([
      expect.objectContaining({ id: "bad", retryCount: 0, serverErrorCount: 20 }),
      expect.objectContaining({ id: "behind" }),
    ]);

    expect(await flushQueue()).toEqual({ synced: 1, failed: 0, dropped: 1 });
    expect(dropped).toHaveBeenCalledWith(expect.objectContaining({ id: "bad", reason: "max_retries" }));
    expect(getPendingCount()).toBe(0);
    unsubscribe();
  });

  it("doesn't write a replay's leftovers back once sign-out cleared the queue mid-run", async () => {
    let failReplay: (error: Error) => void = () => {};
    vi.mocked(apiRequest).mockReturnValueOnce(
      new Promise<Response>((_resolve, reject) => {
        failReplay = reject;
      }),
    );
    reconcileQueueOwner("user-a");
    enqueueMutation("POST", "/api/v1/workouts", { title: "A's" }, { id: "a-1" });
    enqueueMutation("POST", "/api/v1/workouts", { title: "A's second" }, { id: "a-2" });

    const run = flushQueue();
    clearOfflineQueue(); // signs out while the first replay is still in flight
    failReplay(new TypeError("Failed to fetch"));
    await run;

    // The next athlete on this device must not inherit (and replay) A's writes.
    reconcileQueueOwner("user-b");
    expect(getPendingCount()).toBe(0);
  });

  it("stops at the first failed entry so a later edit to the same record cannot land first (CL29)", async () => {
    vi.mocked(apiRequest)
      .mockRejectedValueOnce(new Error("503: Service Unavailable"))
      .mockResolvedValue(new Response("{}"));
    enqueueMutation("PATCH", "/api/v1/plans/days/d1/status", { status: "skipped" }, { id: "first" });
    enqueueMutation("PATCH", "/api/v1/plans/days/d1/status", { status: "completed" }, { id: "second" });

    expect(await flushQueue()).toEqual({ synced: 0, failed: 1, dropped: 0 });
    // The newer edit was held back, not sent past the one that failed.
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(readStoredQueue().map((m) => m.id)).toEqual(["first", "second"]);

    expect(await flushQueue()).toEqual({ synced: 2, failed: 0, dropped: 0 });
    // The server sees the edits in the order the athlete made them, so the
    // day ends on their last action.
    expect(sentBodies()).toEqual([{ status: "skipped" }, { status: "skipped" }, { status: "completed" }]);
    expect(getPendingCount()).toBe(0);
  });

  it("holds later entries behind a rejected one only until the rejected one is dropped (CL29)", async () => {
    const dropped = vi.fn();
    const unsubscribe = onMutationDropped(dropped);
    vi.mocked(apiRequest).mockImplementation(async (_method, url) => {
      if (url === "/api/v1/plans/days/gone/status") throw new Error('404: {"error":"Plan day not found"}');
      return new Response("{}");
    });
    enqueueMutation("PATCH", "/api/v1/plans/days/gone/status", { status: "skipped" }, { id: "rejected" });
    enqueueMutation("POST", "/api/v1/workouts", { title: "Behind it" }, { id: "behind" });

    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(await flushQueue()).toEqual({ synced: 0, failed: 1, dropped: 0 });
      expect(readStoredQueue().map((m) => [m.id, m.retryCount])).toEqual([
        ["rejected", attempt],
        ["behind", 0],
      ]);
    }

    expect(await flushQueue()).toEqual({ synced: 1, failed: 0, dropped: 1 });
    expect(dropped).toHaveBeenCalledWith(expect.objectContaining({ id: "rejected", reason: "max_retries" }));
    expect(sentBodies().at(-1)).toEqual({ title: "Behind it" });
    expect(getPendingCount()).toBe(0);
    unsubscribe();
  });

  describe("scheduled retries (CL27)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("retries a write queued while the browser still reports online, without an online event", async () => {
      vi.mocked(apiRequest).mockResolvedValue(new Response("{}"));
      reconcileQueueOwner("user-a");
      // e.g. runWithOfflineFallback queued it after a 15s timeout on slow wifi.
      enqueueMutation("POST", "/api/v1/workouts", { title: "Timed out" }, { id: "timed-out" });
      expect(apiRequest).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(apiRequest).toHaveBeenCalledExactlyOnceWith("POST", "/api/v1/workouts", { title: "Timed out" }, undefined, {
        "X-Idempotency-Key": "timed-out",
      });
      expect(getPendingCount()).toBe(0);
    });

    it("replays a save that timed out while online under the key its live attempt used", async () => {
      const { runWithOfflineFallback } = await import("./offlineMutationFallback");
      vi.mocked(apiRequest).mockResolvedValue(new Response("{}"));
      reconcileQueueOwner("user-a");
      const body = { title: "Slow gym wifi" };

      const result = await runWithOfflineFallback({
        method: "POST",
        url: "/api/v1/workouts",
        body,
        perform: () => Promise.reject(new Error("Request timed out")),
      });
      expect(result.status).toBe("queued");
      const id = result.status === "queued" ? result.id : "";

      await vi.advanceTimersByTimeAsync(5_000);

      // Same idempotency key, so a live attempt that did commit dedupes server-side.
      expect(apiRequest).toHaveBeenCalledExactlyOnceWith("POST", "/api/v1/workouts", body, undefined, {
        "X-Idempotency-Key": id,
      });
      expect(getPendingCount()).toBe(0);
    });

    it("backs off between retries while replays keep failing", async () => {
      vi.mocked(apiRequest).mockRejectedValue(new TypeError("Failed to fetch"));
      reconcileQueueOwner("user-a");
      enqueueMutation("POST", "/api/v1/workouts", { title: "Flaky" }, { id: "flaky" });

      await vi.advanceTimersByTimeAsync(5_000);
      expect(apiRequest).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(apiRequest).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(apiRequest).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(apiRequest).toHaveBeenCalledTimes(3);

      vi.mocked(apiRequest).mockResolvedValue(new Response("{}"));
      await vi.advanceTimersByTimeAsync(40_000);
      expect(apiRequest).toHaveBeenCalledTimes(4);
      expect(getPendingCount()).toBe(0);
    });

    it.each([
      ["focus", () => globalThis.dispatchEvent(new Event("focus"))],
      ["visibilitychange", () => document.dispatchEvent(new Event("visibilitychange"))],
    ])("retries straight away on %s when the athlete comes back to the app", async (_event, comeBack) => {
      vi.mocked(apiRequest).mockResolvedValue(new Response("{}"));
      reconcileQueueOwner("user-a");
      enqueueMutation("POST", "/api/v1/workouts", { title: "Pending" }, { id: "pending" });

      comeBack();
      await vi.advanceTimersByTimeAsync(0);

      expect(apiRequest).toHaveBeenCalledTimes(1);
      expect(getPendingCount()).toBe(0);
    });

    it("never replays before the signed-in user has reconciled the queue's owner", async () => {
      vi.mocked(apiRequest).mockResolvedValue(new Response("{}"));
      enqueueMutation("POST", "/api/v1/workouts", { title: "Someone's" }, { id: "unowned" });

      globalThis.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(60_000);

      expect(apiRequest).not.toHaveBeenCalled();
      expect(getPendingCount()).toBe(1);
    });

    it("holds retries while no signed-in user owns the queue, until the next reconcile", async () => {
      vi.mocked(apiRequest).mockResolvedValue(new Response("{}"));
      reconcileQueueOwner("user-a");
      enqueueMutation("POST", "/api/v1/workouts", { title: "A's" }, { id: "a1" });

      // Signed out without a reload: the next session must reconcile first.
      releaseQueueOwner();
      globalThis.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(apiRequest).not.toHaveBeenCalled();

      reconcileQueueOwner("user-a");
      globalThis.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
      expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    it("leaves an offline queue to the online event", async () => {
      vi.mocked(apiRequest).mockResolvedValue(new Response("{}"));
      reconcileQueueOwner("user-a");
      setOnline(false);
      enqueueMutation("POST", "/api/v1/workouts", { title: "Offline" }, { id: "offline" });

      globalThis.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(60_000);

      expect(apiRequest).not.toHaveBeenCalled();
      expect(getPendingCount()).toBe(1);
    });

    it("starts a new athlete's retries from the base delay, not the previous athlete's backoff", async () => {
      vi.mocked(apiRequest).mockRejectedValue(new TypeError("Failed to fetch"));
      reconcileQueueOwner("user-a");
      enqueueMutation("POST", "/api/v1/workouts", { title: "A's" }, { id: "a" });
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(apiRequest).toHaveBeenCalledTimes(3); // A's next retry is 40s out

      // A's session ended without a sign-out; B signs in on the same page.
      releaseQueueOwner();
      reconcileQueueOwner("user-b");
      vi.mocked(apiRequest).mockClear();
      vi.mocked(apiRequest).mockResolvedValue(new Response("{}"));
      enqueueMutation("POST", "/api/v1/workouts", { title: "B's" }, { id: "b" });
      await vi.advanceTimersByTimeAsync(5_000);

      expect(apiRequest).toHaveBeenCalledExactlyOnceWith("POST", "/api/v1/workouts", { title: "B's" }, undefined, {
        "X-Idempotency-Key": "b",
      });
    });

    it("stops retrying once sign-out clears the queue", async () => {
      vi.mocked(apiRequest).mockResolvedValue(new Response("{}"));
      reconcileQueueOwner("user-a");
      enqueueMutation("POST", "/api/v1/workouts", { title: "Mine" }, { id: "mine" });

      clearOfflineQueue();
      // The next athlete's write must wait for their own reconcile.
      enqueueMutation("POST", "/api/v1/workouts", { title: "Next" }, { id: "next" });
      await vi.advanceTimersByTimeAsync(60_000);

      expect(apiRequest).not.toHaveBeenCalled();
    });
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

  /** Every id given must have been announced as a storage eviction, and no others. */
  const expectStorageDrops = (dropped: ReturnType<typeof vi.fn>, ids: string[]) => {
    expect(dropped).toHaveBeenCalledTimes(ids.length);
    for (const id of ids) {
      expect(dropped).toHaveBeenCalledWith(expect.objectContaining({ id, reason: "storage_full" }));
    }
  };

  it("trims the oldest half of the queue and retries on QuotaExceededError", () => {
    const dropped = vi.fn();
    const unsubscribe = onMutationDropped(dropped);
    // Fill the queue with some mutations
    enqueueMutation("POST", "/api/v1/a", { n: "1" }, { id: "1" });
    enqueueMutation("POST", "/api/v1/a", { n: "2" }, { id: "2" });
    enqueueMutation("POST", "/api/v1/a", { n: "3" }, { id: "3" });
    enqueueMutation("POST", "/api/v1/a", { n: "4" }, { id: "4" });

    // Ensure we have 4 mutations
    expect(getPendingCount()).toBe(4);

    // Mock setItem to throw on the first call, succeed on the second
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    setItemSpy.mockImplementationOnce(() => {
      throw new Error("QuotaExceededError");
    });

    // Trigger a save by enqueuing one more
    enqueueMutation("POST", "/api/v1/a", { n: "5" }, { id: "5" });

    // The initial queue had 4 items, we added 1, so it became 5.
    // It failed, trimmed half (Math.floor(5/2) = 2), so we sliced from index 2, keeping the last 3 items.
    // The last 3 items should be id: "3", "4", "5".
    expect(setItemSpy).toHaveBeenCalledTimes(2);
    expect(getPendingCount()).toBe(3);
    expect(readStoredQueue().map((m) => m.id)).toEqual(["3", "4", "5"]);

    // Evicting is permanent loss of the athlete's logged work, so the two
    // dropped entries have to be announced the same way a queue-overflow
    // eviction is — this path used to discard them in silence.
    expectStorageDrops(dropped, ["1", "2"]);

    setItemSpy.mockRestore();
    unsubscribe();
  });

  it("clears the queue completely if saving trimmed queue still throws QuotaExceededError", () => {
    const dropped = vi.fn();
    const unsubscribe = onMutationDropped(dropped);
    enqueueMutation("POST", "/api/v1/a", { n: "1" }, { id: "1" });
    enqueueMutation("POST", "/api/v1/a", { n: "2" }, { id: "2" });

    expect(getPendingCount()).toBe(2);

    // Mock setItem to throw on all calls
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    setItemSpy.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    // Trigger a save
    enqueueMutation("POST", "/api/v1/a", { n: "3" }, { id: "3" });

    // It should have tried twice and then called removeItem
    expect(setItemSpy).toHaveBeenCalledTimes(2);
    expect(readStoredQueue()).toEqual([]);
    expect(getPendingCount()).toBe(0);

    // The full-clear fallback loses everything, so every entry is announced.
    expectStorageDrops(dropped, ["1", "2", "3"]);

    setItemSpy.mockRestore();
    unsubscribe();
  });

  describe("reconcileQueueOwner", () => {
    it("drops a queue left by a different signed-in user instead of letting it replay", () => {
      const dropped = vi.fn();
      const unsubscribe = onMutationDropped(dropped);

      enqueueMutation("POST", "/api/v1/workouts", { n: "1" }, { id: "1" });
      reconcileQueueOwner("user-a");
      // Simulate the tab closing without an explicit sign-out: the queue and
      // owner stamp are still on disk when "user-b" next signs in.
      enqueueMutation("POST", "/api/v1/workouts", { n: "2" }, { id: "2" });

      expect(getPendingCount()).toBe(2);

      reconcileQueueOwner("user-b");

      expect(getPendingCount()).toBe(0);
      expect(dropped).toHaveBeenCalledWith(expect.objectContaining({ id: "1", reason: "wrong_account" }));
      expect(dropped).toHaveBeenCalledWith(expect.objectContaining({ id: "2", reason: "wrong_account" }));

      unsubscribe();
    });

    it("leaves the queue untouched when the same user reconciles again", () => {
      enqueueMutation("POST", "/api/v1/workouts", { n: "1" }, { id: "1" });
      reconcileQueueOwner("user-a");

      reconcileQueueOwner("user-a");

      expect(getPendingCount()).toBe(1);
    });

    it("does nothing for an unknown (not-yet-loaded) user", () => {
      enqueueMutation("POST", "/api/v1/workouts", { n: "1" }, { id: "1" });
      reconcileQueueOwner("user-a");

      reconcileQueueOwner(undefined);

      expect(getPendingCount()).toBe(1);
    });

    it("clearing the queue also forgets its owner, so the next sign-in starts fresh", () => {
      enqueueMutation("POST", "/api/v1/workouts", { n: "1" }, { id: "1" });
      reconcileQueueOwner("user-a");
      clearOfflineQueue();

      const dropped = vi.fn();
      const unsubscribe = onMutationDropped(dropped);
      enqueueMutation("POST", "/api/v1/workouts", { n: "2" }, { id: "2" });
      reconcileQueueOwner("user-b");

      expect(getPendingCount()).toBe(1);
      expect(dropped).not.toHaveBeenCalled();
      unsubscribe();
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  createSetVersionTracker,
  isSetConflictError,
  SetConflictError,
} from "./exerciseSetVersionLock";

describe("SetConflictError / isSetConflictError", () => {
  it("recognizes a SetConflictError instance", () => {
    expect(isSetConflictError(new SetConflictError("set-1"))).toBe(true);
  });

  it("recognizes an apiRequest 409 thrown as `409: <body>`", () => {
    expect(isSetConflictError(new Error("409: Conflict"))).toBe(true);
  });

  it("rejects an error whose message merely contains 409 elsewhere", () => {
    expect(isSetConflictError(new Error("PATCH /sets/409 failed"))).toBe(false);
  });

  it("rejects non-Error values and other status codes", () => {
    expect(isSetConflictError("409: Conflict")).toBe(false);
    expect(isSetConflictError(new Error("500: Internal Server Error"))).toBe(false);
    expect(isSetConflictError(undefined)).toBe(false);
  });
});

describe("createSetVersionTracker", () => {
  it("has no expected version for a set it has never seen", () => {
    const tracker = createSetVersionTracker();
    expect(tracker.expectedVersion("set-1")).toBeUndefined();
  });

  it("seeds the version from the cached row", () => {
    const tracker = createSetVersionTracker();
    tracker.seed("set-1", 3);
    expect(tracker.expectedVersion("set-1")).toBe(3);
  });

  it("never lowers a known version when re-seeded with an older one", () => {
    const tracker = createSetVersionTracker();
    tracker.seed("set-1", 5);
    tracker.seed("set-1", 2);
    expect(tracker.expectedVersion("set-1")).toBe(5);
  });

  it("ignores a seed that is not a positive integer", () => {
    const tracker = createSetVersionTracker();
    tracker.seed("set-1", 0);
    expect(tracker.expectedVersion("set-1")).toBeUndefined();
    tracker.seed("set-1", 1.5);
    expect(tracker.expectedVersion("set-1")).toBeUndefined();
    tracker.seed("set-1", "3");
    expect(tracker.expectedVersion("set-1")).toBeUndefined();
    tracker.seed("set-1", undefined);
    expect(tracker.expectedVersion("set-1")).toBeUndefined();
  });

  it("records the version reported by a PATCH response, even lowering it", () => {
    const tracker = createSetVersionTracker();
    tracker.seed("set-1", 5);
    // A PATCH response always carries the version straight from the row a
    // successful write just produced — take it as-is, don't clamp it up.
    tracker.noteServerVersion("set-1", 4);
    expect(tracker.expectedVersion("set-1")).toBe(4);
  });

  it("ignores a server version that is not a positive integer", () => {
    const tracker = createSetVersionTracker();
    tracker.seed("set-1", 5);
    tracker.noteServerVersion("set-1", null);
    expect(tracker.expectedVersion("set-1")).toBe(5);
  });

  it("forgets the version after a conflict", () => {
    const tracker = createSetVersionTracker();
    tracker.seed("set-1", 5);
    tracker.markConflict("set-1");
    expect(tracker.expectedVersion("set-1")).toBeUndefined();
  });

  it("clears the conflicted flag for a set once it is re-seeded from a fresh row", () => {
    const tracker = createSetVersionTracker();
    tracker.seed("set-1", 5);
    tracker.markConflict("set-1");
    tracker.seed("set-1", 7);

    // A queued task enqueued after the re-seed must run, not be rejected as
    // stale — the conflict is over as soon as the row is refreshed.
    return expect(tracker.enqueue("set-1", async () => "ran")).resolves.toBe("ran");
  });

  it("resets every set's version, conflict flag, and queue", () => {
    const tracker = createSetVersionTracker();
    tracker.seed("set-1", 5);
    tracker.markConflict("set-2");
    tracker.reset();

    expect(tracker.expectedVersion("set-1")).toBeUndefined();
    return expect(tracker.enqueue("set-2", async () => "ran")).resolves.toBe("ran");
  });

  describe("enqueue", () => {
    it("runs a single task immediately", async () => {
      const tracker = createSetVersionTracker();
      await expect(tracker.enqueue("set-1", async () => "done")).resolves.toBe("done");
    });

    it("serializes two edits to the same set: the second waits for the first", async () => {
      const tracker = createSetVersionTracker();
      const order: string[] = [];
      let resolveFirst!: () => void;
      const first = tracker.enqueue("set-1", () => {
        order.push("first-start");
        return new Promise<string>((resolve) => {
          resolveFirst = () => {
            order.push("first-end");
            resolve("first");
          };
        });
      });
      const second = tracker.enqueue("set-1", async () => {
        order.push("second-start");
        return "second";
      });

      // The second task must not have started while the first is still pending.
      await Promise.resolve();
      await Promise.resolve();
      expect(order).toEqual(["first-start"]);

      resolveFirst();
      await expect(first).resolves.toBe("first");
      await expect(second).resolves.toBe("second");
      expect(order).toEqual(["first-start", "first-end", "second-start"]);
    });

    it("runs tasks for different sets independently, without waiting on each other", async () => {
      const tracker = createSetVersionTracker();
      const order: string[] = [];
      let resolveA!: () => void;
      const a = tracker.enqueue("set-a", () => {
        order.push("a-start");
        return new Promise<void>((resolve) => {
          resolveA = () => {
            order.push("a-end");
            resolve();
          };
        });
      });
      const b = tracker.enqueue("set-b", async () => {
        order.push("b");
      });

      await b;
      expect(order).toEqual(["a-start", "b"]);

      resolveA();
      await a;
    });

    it("rejects a task queued behind one that hit a conflict, without calling it", async () => {
      const tracker = createSetVersionTracker();
      tracker.seed("set-1", 5);
      let resolveFirst!: (v: string) => void;
      const first = tracker.enqueue("set-1", () => new Promise<string>((resolve) => {
        resolveFirst = resolve;
      }));

      const queuedTask = vi.fn(async () => "should not run");
      const second = tracker.enqueue("set-1", queuedTask);

      // Let the first task's executor actually run before resolving it.
      await Promise.resolve();
      await Promise.resolve();

      // The first PATCH comes back a 409; the caller marks the conflict before
      // the first task's own resolution is awaited by the chain.
      tracker.markConflict("set-1");
      resolveFirst("first");

      await expect(first).resolves.toBe("first");
      await expect(second).rejects.toThrow(SetConflictError);
      expect(queuedTask).not.toHaveBeenCalled();
    });

    it("recovers the queue after a task throws: the next enqueue on that set still runs", async () => {
      const tracker = createSetVersionTracker();
      const failing = tracker.enqueue("set-1", async () => {
        throw new Error("network error");
      });
      await expect(failing).rejects.toThrow("network error");

      await expect(tracker.enqueue("set-1", async () => "recovered")).resolves.toBe("recovered");
    });
  });
});

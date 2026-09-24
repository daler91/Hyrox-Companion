import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {} }));

import { db } from "../db";
import { MAX_PUSH_SUBSCRIPTIONS_PER_USER, PushStorage } from "./push";

/**
 * Program-order query-builder mock (mirrors recycleBinCapture.test.ts): every
 * chain method returns the mock itself, which is a thenable resolving the
 * next queued result, so a query can end on `where`, `orderBy`, `limit` or
 * `onConflictDoUpdate` alike. Queue results in the order the code awaits them.
 */
function makeDb() {
  const results: unknown[] = [];
  const mock: Record<string, ReturnType<typeof vi.fn>> & { queue: (...next: unknown[]) => void } = {
    queue: (...next: unknown[]) => {
      results.push(...next);
    },
  } as never;
  for (const method of ["select", "from", "where", "orderBy", "limit", "insert", "values", "onConflictDoUpdate", "delete"]) {
    mock[method] = vi.fn().mockReturnValue(mock);
  }
  mock.then = vi.fn((resolve: (value: unknown) => unknown) =>
    Promise.resolve(results.shift()).then(resolve),
  );
  return mock;
}

describe("PushStorage.saveSubscription eviction", () => {
  const storage = new PushStorage();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not delete anything when the user is under the device cap", async () => {
    const mock = makeDb();
    mock.queue(
      undefined, // insert().values().onConflictDoUpdate()
      [{ total: MAX_PUSH_SUBSCRIPTIONS_PER_USER }], // select count() <= limit
    );
    Object.assign(db, mock);

    await storage.saveSubscription("u1", { endpoint: "https://push.example/e1", p256dh: "k", auth: "a" });

    expect(mock.delete).not.toHaveBeenCalled();
  });

  it("evicts exactly the oldest rows beyond the cap when over the limit", async () => {
    const mock = makeDb();
    const staleRows = [{ id: "old-1" }];
    mock.queue(
      undefined, // insert
      [{ total: MAX_PUSH_SUBSCRIPTIONS_PER_USER + 1 }], // one over the cap
      staleRows, // select id ... orderBy(createdAt asc) limit(1)
      undefined, // delete
    );
    Object.assign(db, mock);

    await storage.saveSubscription("u1", { endpoint: "https://push.example/e2", p256dh: "k", auth: "a" });

    expect(mock.limit).toHaveBeenCalledWith(1);
    expect(mock.delete).toHaveBeenCalledTimes(1);
  });

  it("does not delete when the stale lookup comes back empty despite being over the cap", async () => {
    const mock = makeDb();
    mock.queue(
      undefined, // insert
      [{ total: MAX_PUSH_SUBSCRIPTIONS_PER_USER + 5 }],
      [], // race: nothing left to evict
    );
    Object.assign(db, mock);

    await storage.saveSubscription("u1", { endpoint: "https://push.example/e3", p256dh: "k", auth: "a" });

    expect(mock.delete).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {} }));

import { db } from "../db";
import { makeQueryBuilderMock } from "./__tests__/queryBuilderMock";
import { MAX_PUSH_SUBSCRIPTIONS_PER_USER, PushStorage } from "./push";

const makeDb = () =>
  makeQueryBuilderMock(["select", "from", "where", "orderBy", "limit", "insert", "values", "onConflictDoUpdate", "delete"]);

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

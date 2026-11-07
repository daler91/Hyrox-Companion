import { devicePushTokens, pushSubscriptions } from "@shared/schema";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {} }));

import { db } from "../db";
import { makeQueryBuilderMock } from "./__tests__/queryBuilderMock";
import { MAX_DEVICE_PUSH_TOKENS_PER_USER, MAX_PUSH_SUBSCRIPTIONS_PER_USER, PushStorage } from "./push";

const makeDb = () =>
  makeQueryBuilderMock(["select", "from", "where", "orderBy", "limit", "insert", "values", "onConflictDoUpdate", "delete"]);

// Fake Web Push subscription keys, matching the placeholder convention
// pushNotifications.test.ts already uses for this exact shape.
const subscription = (endpoint: string) => ({ endpoint, p256dh: "p256dh", auth: "auth" });

describe("PushStorage.saveSubscription eviction", () => {
  const storage = new PushStorage();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Every save starts with the endpoint handover below, so "evicted nothing"
  // means that one delete and no other.
  it("does not evict anything when the user is under the device cap", async () => {
    const mock = makeDb();
    mock.queue(
      undefined, // delete: endpoint handover
      undefined, // insert().values().onConflictDoUpdate()
      [{ total: MAX_PUSH_SUBSCRIPTIONS_PER_USER }], // select count() <= limit
    );
    Object.assign(db, mock);

    await storage.saveSubscription("u1", subscription("https://push.example/e1"));

    expect(mock.delete).toHaveBeenCalledTimes(1);
    expect(mock.limit).not.toHaveBeenCalled();
  });

  it("evicts exactly the oldest rows beyond the cap when over the limit", async () => {
    const mock = makeDb();
    const staleRows = [{ id: "old-1" }];
    mock.queue(
      undefined, // delete: endpoint handover
      undefined, // insert
      [{ total: MAX_PUSH_SUBSCRIPTIONS_PER_USER + 1 }], // one over the cap
      staleRows, // select id ... orderBy(createdAt asc) limit(1)
    );
    Object.assign(db, mock);

    await storage.saveSubscription("u1", subscription("https://push.example/e2"));

    expect(mock.limit).toHaveBeenCalledWith(1);
    expect(mock.delete).toHaveBeenCalledTimes(2);
  });

  it("does not evict when the stale lookup comes back empty despite being over the cap", async () => {
    const mock = makeDb();
    mock.queue(
      undefined, // delete: endpoint handover
      undefined, // insert
      [{ total: MAX_PUSH_SUBSCRIPTIONS_PER_USER + 5 }],
      [], // race: nothing left to evict
    );
    Object.assign(db, mock);

    await storage.saveSubscription("u1", subscription("https://push.example/e3"));

    expect(mock.delete).toHaveBeenCalledTimes(1);
  });
});

// P3 (CODEBASE_ANALYSIS_2026-10-03): a push endpoint identifies a browser, not
// an athlete. Kept per (user, endpoint), a shared device that a second athlete
// subscribed on received both athletes' notifications.
describe("PushStorage.saveSubscription endpoint handover", () => {
  const storage = new PushStorage();
  const dialect = new PgDialect();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes the endpoint from every OTHER user before saving it for this one", async () => {
    const mock = makeDb();
    mock.queue(undefined, undefined, [{ total: 1 }]);
    Object.assign(db, mock);

    await storage.saveSubscription("athlete-b", subscription("https://push.example/shared-device"));

    expect(mock.delete).toHaveBeenNthCalledWith(1, pushSubscriptions);
    const handover = dialect.sqlToQuery(mock.where.mock.calls[0][0] as SQL);
    expect(handover.sql).toBe(
      '("push_subscriptions"."endpoint" = $1 and "push_subscriptions"."user_id" <> $2)',
    );
    expect(handover.params).toEqual(["https://push.example/shared-device", "athlete-b"]);
    // ...and only then the save itself.
    expect(mock.delete.mock.invocationCallOrder[0]).toBeLessThan(mock.insert.mock.invocationCallOrder[0]);
  });
});

describe("PushStorage.saveDeviceToken", () => {
  const storage = new PushStorage();
  const dialect = new PgDialect();
  const device = { token: "tok-1", platform: "android" as const, appVersion: "1.0.0" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts on the token alone, moving an install to whoever registers it and refreshing last_seen_at", async () => {
    const mock = makeDb();
    mock.queue(undefined, [{ total: 1 }]);
    Object.assign(db, mock);

    await storage.saveDeviceToken("athlete-b", device);

    expect(mock.insert).toHaveBeenCalledWith(devicePushTokens);
    expect(mock.values).toHaveBeenCalledWith({ userId: "athlete-b", ...device });
    const upsert = mock.onConflictDoUpdate.mock.calls[0][0] as { target: unknown; set: Record<string, unknown> };
    expect(upsert.target).toBe(devicePushTokens.token);
    expect(upsert.set).toMatchObject({ userId: "athlete-b", platform: "android", appVersion: "1.0.0" });
    expect(dialect.sqlToQuery(upsert.set.lastSeenAt as SQL).sql).toBe("now()");
    expect(mock.delete).not.toHaveBeenCalled();
  });

  it("evicts the least recently seen installs beyond the cap", async () => {
    const mock = makeDb();
    mock.queue(undefined, [{ total: MAX_DEVICE_PUSH_TOKENS_PER_USER + 2 }], [{ id: "old-1" }, { id: "old-2" }]);
    Object.assign(db, mock);

    await storage.saveDeviceToken("u1", device);

    expect(mock.limit).toHaveBeenCalledWith(2);
    expect(mock.delete).toHaveBeenCalledWith(devicePushTokens);
  });

  it("scopes unregistering to the athlete, so nobody can remove another athlete's install", async () => {
    const mock = makeDb();
    mock.queue({ rowCount: 1 });
    Object.assign(db, mock);

    const removed = await storage.removeDeviceToken("u1", "tok-1");

    expect(removed).toBe(true);
    const where = dialect.sqlToQuery(mock.where.mock.calls[0][0] as SQL);
    expect(where.sql).toBe('("device_push_tokens"."user_id" = $1 and "device_push_tokens"."token" = $2)');
    expect(where.params).toEqual(["u1", "tok-1"]);
  });
});

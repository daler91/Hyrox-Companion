import express from "express";
import rateLimit from "express-rate-limit";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "./db";
import { PostgresRateLimitStore } from "./rateLimitStore";

/**
 * A11 (CODEBASE_ANALYSIS_2026-10-03), against real Postgres. Every test, smoke
 * and Cypress lane runs with NODE_ENV=test, where createRateLimitStore hands
 * out a MemoryStore, and the unit test only echoes a mocked row. So the SQL
 * behind the fail-closed limiter on every mutating route (the upsert, the
 * window reset, the decrement) ran for the first time in production; a broken
 * reset there would 429 every POST, PATCH and DELETE after the first window.
 * The store is used directly here, bypassing that NODE_ENV switch.
 */

const KEY_PREFIX = "a11-it:";
const WINDOW_MS = 60_000;

function key(name: string): string {
  return `${KEY_PREFIX}${name}`;
}

/** Move a bucket's window into the past, as if the window had elapsed. */
async function expireWindow(bucketKey: string): Promise<void> {
  await pool.query(
    "update rate_limit_buckets set reset_at = now() - interval '1 second' where key = $1",
    [bucketKey],
  );
}

async function storedHits(bucketKey: string): Promise<number | undefined> {
  const result = await pool.query<{ hit_count: number }>(
    "select hit_count from rate_limit_buckets where key = $1",
    [bucketKey],
  );
  const row = result.rows.at(0);
  return row === undefined ? undefined : Number(row.hit_count);
}

async function clearTestBuckets(): Promise<void> {
  await pool.query("delete from rate_limit_buckets where key like $1", [`${KEY_PREFIX}%`]);
}

describe("PostgresRateLimitStore (real Postgres)", () => {
  const store = new PostgresRateLimitStore("a11", WINDOW_MS);

  beforeEach(async () => {
    await clearTestBuckets();
  });

  afterAll(async () => {
    await clearTestBuckets();
  });

  it("upserts: the first hit opens a window, later hits count within it", async () => {
    const before = Date.now();
    const first = await store.increment(key("upsert"));
    const second = await store.increment(key("upsert"));

    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
    // Later hits keep the window the first one opened.
    expect(second.resetTime?.getTime()).toBe(first.resetTime?.getTime());
    expect(first.resetTime?.getTime()).toBeGreaterThanOrEqual(before + WINDOW_MS - 1_000);
    await expect(store.get(key("upsert"))).resolves.toMatchObject({ totalHits: 2 });
  });

  it("restarts the count and the window once the window has passed", async () => {
    await store.increment(key("reset"));
    await store.increment(key("reset"));
    await store.increment(key("reset"));
    await expireWindow(key("reset"));

    // An expired bucket reads as no bucket at all.
    await expect(store.get(key("reset"))).resolves.toBeUndefined();

    const fresh = await store.increment(key("reset"));
    expect(fresh.totalHits).toBe(1);
    expect(fresh.resetTime?.getTime()).toBeGreaterThan(Date.now());
  });

  it("decrements within the window, never below zero", async () => {
    await store.increment(key("decrement"));
    await store.increment(key("decrement"));

    await store.decrement(key("decrement"));
    expect(await storedHits(key("decrement"))).toBe(1);

    await store.decrement(key("decrement"));
    await store.decrement(key("decrement"));
    expect(await storedHits(key("decrement"))).toBe(0);
  });

  it("leaves an expired bucket alone on decrement", async () => {
    await store.increment(key("expired-decrement"));
    await store.increment(key("expired-decrement"));
    await expireWindow(key("expired-decrement"));

    await store.decrement(key("expired-decrement"));

    expect(await storedHits(key("expired-decrement"))).toBe(2);
  });

  it("drops one key on resetKey", async () => {
    await store.increment(key("drop"));
    await store.increment(key("keep"));

    await store.resetKey(key("drop"));

    expect(await storedHits(key("drop"))).toBeUndefined();
    expect(await storedHits(key("keep"))).toBe(1);
  });

  it("lets a limited client through again after the window, behind express-rate-limit", async () => {
    const limited = key("limiter");
    const app = express();
    app.use(
      rateLimit({
        windowMs: WINDOW_MS,
        max: 2,
        store: new PostgresRateLimitStore("a11-limiter", WINDOW_MS),
        keyGenerator: () => limited,
        validate: { default: false },
      }),
    );
    app.post("/write", (_req, res) => {
      res.json({ ok: true });
    });

    expect((await request(app).post("/write")).status).toBe(200);
    expect((await request(app).post("/write")).status).toBe(200);
    expect((await request(app).post("/write")).status).toBe(429);

    await expireWindow(limited);

    expect((await request(app).post("/write")).status).toBe(200);
  });
});

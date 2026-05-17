import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({
  pool: { query: queryMock },
}));

import { PostgresRateLimitStore } from "./rateLimitStore";

describe("PostgresRateLimitStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    queryMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("increments a bucket atomically and returns reset metadata", async () => {
    const resetAt = new Date("2026-05-17T12:01:00Z");
    queryMock.mockResolvedValueOnce({ rows: [{ hit_count: 2, reset_at: resetAt }] });

    const store = new PostgresRateLimitStore("api", 60_000);

    await expect(store.increment("api:user:user-1")).resolves.toEqual({
      totalHits: 2,
      resetTime: resetAt,
    });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("on conflict"),
      ["api:user:user-1", resetAt],
    );
    expect(store.localKeys).toBe(false);
  });

  it("reads active buckets and ignores missing buckets", async () => {
    const resetAt = new Date("2026-05-17T12:01:00Z");
    queryMock
      .mockResolvedValueOnce({ rows: [{ hit_count: 4, reset_at: resetAt }] })
      .mockResolvedValueOnce({ rows: [] });

    const store = new PostgresRateLimitStore("api", 60_000);

    await expect(store.get("api:user:user-1")).resolves.toEqual({ totalHits: 4, resetTime: resetAt });
    await expect(store.get("api:user:missing")).resolves.toBeUndefined();
  });

  it("supports decrement and reset operations", async () => {
    queryMock.mockResolvedValue({ rowCount: 1 });
    const store = new PostgresRateLimitStore("api", 60_000);

    await store.decrement("api:user:user-1");
    await store.resetKey("api:user:user-1");
    await store.resetAll();

    expect(queryMock).toHaveBeenNthCalledWith(1, expect.stringContaining("greatest"), ["api:user:user-1"]);
    expect(queryMock).toHaveBeenNthCalledWith(2, "delete from rate_limit_buckets where key = $1", ["api:user:user-1"]);
    expect(queryMock).toHaveBeenNthCalledWith(3, "delete from rate_limit_buckets");
  });
});

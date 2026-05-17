import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({
  pool: { query: queryMock },
}));

import {
  cleanupExpiredSharedRuntimeState,
  deleteRuntimeCache,
  deleteRuntimeCachePrefix,
  getRuntimeCache,
  hashRuntimeKey,
  runtimeCacheKey,
  setRuntimeCache,
} from "./sharedRuntimeState";

describe("shared runtime state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    queryMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hashes cache keys without exposing the source value", () => {
    const hashed = runtimeCacheKey("auth-seen", "user_123");

    expect(hashed).toMatch(/^auth-seen:[a-f0-9]{64}$/);
    expect(hashed).not.toContain("user_123");
    expect(hashRuntimeKey("same")).toBe(hashRuntimeKey("same"));
  });

  it("reads a live cache value", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ value: { ok: true } }] });

    await expect(getRuntimeCache<{ ok: boolean }>("key-1")).resolves.toEqual({ ok: true });
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("expires_at > now()"), ["key-1"]);
  });

  it("returns undefined for cache misses", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(getRuntimeCache("missing")).resolves.toBeUndefined();
  });

  it("upserts cache values with an expiry", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });

    await setRuntimeCache("key-1", { values: [1, 2, 3] }, 60_000);

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("on conflict"),
      ["key-1", JSON.stringify({ values: [1, 2, 3] }), new Date("2026-05-17T12:01:00Z")],
    );
  });

  it("deletes exact and prefix cache entries", async () => {
    queryMock.mockResolvedValue({ rowCount: 1 });

    await deleteRuntimeCache("exact");
    await deleteRuntimeCachePrefix("rag:abc:");

    expect(queryMock).toHaveBeenNthCalledWith(1, "delete from server_runtime_cache where key = $1", ["exact"]);
    expect(queryMock).toHaveBeenNthCalledWith(2, "delete from server_runtime_cache where key like $1", ["rag:abc:%"]);
  });

  it("cleans up expired shared state rows", async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 3 })
      .mockResolvedValueOnce({ rowCount: 5 });

    await expect(cleanupExpiredSharedRuntimeState()).resolves.toEqual({
      rateLimitBuckets: 3,
      runtimeCache: 5,
    });
  });
});

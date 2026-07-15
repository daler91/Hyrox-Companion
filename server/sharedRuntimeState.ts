import { createHash } from "node:crypto";

import { pool } from "./db";

export function hashRuntimeKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function runtimeCacheKey(scope: string, value: string): string {
  return `${scope}:${hashRuntimeKey(value)}`;
}

export async function getRuntimeCache<T>(key: string): Promise<T | undefined> {
  const result = await pool.query<{ value: T }>(
    `select value
     from server_runtime_cache
     where key = $1
       and expires_at > now()`,
    [key],
  );
  return result.rows[0]?.value;
}

export async function setRuntimeCache(key: string, value: unknown, ttlMs: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs);
  await pool.query(
    `insert into server_runtime_cache (key, value, expires_at, updated_at)
     values ($1, $2::jsonb, $3, now())
     on conflict (key) do update
       set value = excluded.value,
           expires_at = excluded.expires_at,
           updated_at = now()`,
    [key, JSON.stringify(value), expiresAt],
  );
}

/**
 * Atomically claims `key` for single-use semantics (e.g. consuming an OAuth
 * state nonce). Returns true when this caller made the claim, false when a
 * live claim already exists. Unlike get-then-set, the unique key makes
 * concurrent claims race-safe: exactly one caller wins. An EXPIRED row with
 * the same key can be re-claimed (relevant because the cleanup cron only
 * sweeps periodically).
 */
export async function claimRuntimeCacheKey(key: string, ttlMs: number): Promise<boolean> {
  const expiresAt = new Date(Date.now() + ttlMs);
  const result = await pool.query(
    `insert into server_runtime_cache (key, value, expires_at, updated_at)
     values ($1, 'true'::jsonb, $2, now())
     on conflict (key) do update
       set value = excluded.value,
           expires_at = excluded.expires_at,
           updated_at = now()
       where server_runtime_cache.expires_at <= now()`,
    [key, expiresAt],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteRuntimeCache(key: string): Promise<void> {
  await pool.query("delete from server_runtime_cache where key = $1", [key]);
}

export async function deleteRuntimeCachePrefix(prefix: string): Promise<void> {
  await pool.query("delete from server_runtime_cache where key like $1", [`${prefix}%`]);
}

export async function cleanupExpiredSharedRuntimeState(): Promise<{ rateLimitBuckets: number; runtimeCache: number }> {
  const [rateLimitResult, cacheResult] = await Promise.all([
    pool.query("delete from rate_limit_buckets where reset_at <= now()"),
    pool.query("delete from server_runtime_cache where expires_at <= now()"),
  ]);
  return {
    rateLimitBuckets: rateLimitResult.rowCount ?? 0,
    runtimeCache: cacheResult.rowCount ?? 0,
  };
}

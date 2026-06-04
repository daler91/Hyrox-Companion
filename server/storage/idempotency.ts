import { idempotencyKeys } from "@shared/schema";
import { and, eq, lt, lte } from "drizzle-orm";

import { db } from "../db";

export interface IdempotencyRecord {
  statusCode: number;
  responseBody: unknown;
}

/**
 * An in-progress claim is stored as a row with this status code (no real HTTP
 * response is 0) and a short TTL, so a concurrent request can tell an in-flight
 * claim from a cached 2xx response.
 */
const IN_PROGRESS_STATUS = 0;
const IN_PROGRESS_BODY = { __idempotencyInProgress: true as const };

export type IdempotencyClaim =
  | { outcome: "claimed" }
  | { outcome: "in_progress" }
  | { outcome: "completed"; statusCode: number; responseBody: unknown };

/**
 * Storage for cached responses to mutating requests, keyed by
 * (userId, X-Idempotency-Key). Backs the idempotency middleware
 * (CODEBASE_AUDIT.md §2). Entries TTL via `expiresAt`; stale rows are pruned
 * by `cleanupExpired` which runs from a daily cron.
 */
export class IdempotencyStorage {
  async get(userId: string, key: string): Promise<IdempotencyRecord | undefined> {
    const [row] = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
    if (!row) return undefined;
    if (row.expiresAt.getTime() <= Date.now()) return undefined;
    return { statusCode: row.statusCode, responseBody: row.responseBody };
  }

  /**
   * Atomically claim (userId, key) for an in-flight request BEFORE its handler
   * runs — closing the check-then-act race where two concurrent requests both
   * miss the lookup and both execute (W11). Inserts a short-lived in-progress
   * row; on conflict it takes over an EXPIRED row (a crashed/abandoned claim or
   * a lapsed cache entry) via the setWhere guard, but never overwrites a LIVE
   * row, instead reporting whether that row is still in progress or completed.
   */
  async claim(
    userId: string,
    key: string,
    meta: { method: string; path: string },
    claimTtlSeconds: number,
  ): Promise<IdempotencyClaim> {
    const claimExpiry = new Date(Date.now() + claimTtlSeconds * 1000);
    const claimed = await db
      .insert(idempotencyKeys)
      .values({
        userId,
        key,
        method: meta.method,
        path: meta.path,
        statusCode: IN_PROGRESS_STATUS,
        responseBody: IN_PROGRESS_BODY,
        expiresAt: claimExpiry,
      })
      .onConflictDoUpdate({
        target: [idempotencyKeys.userId, idempotencyKeys.key],
        set: {
          method: meta.method,
          path: meta.path,
          statusCode: IN_PROGRESS_STATUS,
          responseBody: IN_PROGRESS_BODY,
          createdAt: new Date(),
          expiresAt: claimExpiry,
        },
        // Only take over a row whose TTL has already lapsed. A live row — an
        // in-flight claim or a cached response — is left untouched (0 rows
        // returned), and we classify it below.
        setWhere: lte(idempotencyKeys.expiresAt, new Date()),
      })
      .returning({ userId: idempotencyKeys.userId });

    if (claimed.length > 0) return { outcome: "claimed" };

    const existing = await this.get(userId, key);
    if (!existing || existing.statusCode === IN_PROGRESS_STATUS) {
      return { outcome: "in_progress" };
    }
    return { outcome: "completed", statusCode: existing.statusCode, responseBody: existing.responseBody };
  }

  /**
   * Replace this request's in-progress claim with its final 2xx response and
   * extend the row to the full idempotency TTL so later replays hit the cache.
   */
  async complete(
    userId: string,
    key: string,
    record: { statusCode: number; responseBody: unknown },
    ttlSeconds: number,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await db
      .update(idempotencyKeys)
      .set({ statusCode: record.statusCode, responseBody: record.responseBody, expiresAt })
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
  }

  /**
   * Drop an in-progress claim so a failed or aborted request can be retried.
   * Scoped to the in-progress status so a row that already holds a real
   * response is never deleted.
   */
  async release(userId: string, key: string): Promise<void> {
    await db
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.userId, userId),
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.statusCode, IN_PROGRESS_STATUS),
        ),
      );
  }

  async cleanupExpired(): Promise<number> {
    const result = await db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expiresAt, new Date()))
      .returning({ userId: idempotencyKeys.userId });
    return result.length;
  }
}

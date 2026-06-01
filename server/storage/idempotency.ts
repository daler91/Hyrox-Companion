import { idempotencyKeys } from "@shared/schema";
import { and, eq, lt } from "drizzle-orm";

import { db } from "../db";

export interface IdempotencyRecord {
  statusCode: number;
  responseBody: unknown;
}

/**
 * Storage for cached responses to mutating requests, keyed by
 * (userId, X-Idempotency-Key, method, path). Backs the idempotency middleware
 * (CODEBASE_AUDIT.md §2). Matching on method+path as well as the key prevents a
 * client that reuses one key across two endpoints from getting the first
 * endpoint's cached response back for the second (S1). Entries TTL via
 * `expiresAt`; stale rows are pruned by `cleanupExpired` on a daily cron.
 */
export class IdempotencyStorage {
  async get(userId: string, key: string, method: string, path: string): Promise<IdempotencyRecord | undefined> {
    const [row] = await db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.userId, userId),
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.method, method),
          eq(idempotencyKeys.path, path),
        ),
      );
    if (!row) return undefined;
    if (row.expiresAt.getTime() <= Date.now()) return undefined;
    return { statusCode: row.statusCode, responseBody: row.responseBody };
  }

  async set(
    userId: string,
    key: string,
    record: { method: string; path: string; statusCode: number; responseBody: unknown },
    ttlSeconds: number,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    // onConflictDoNothing: the first response wins. A second concurrent
    // request with the same key will see the stored row on its lookup or
    // (if it raced past the SELECT) be harmlessly ignored here.
    await db
      .insert(idempotencyKeys)
      .values({
        userId,
        key,
        method: record.method,
        path: record.path,
        statusCode: record.statusCode,
        responseBody: record.responseBody,
        expiresAt,
      })
      .onConflictDoNothing();
  }

  async cleanupExpired(): Promise<number> {
    const result = await db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expiresAt, new Date()))
      .returning({ userId: idempotencyKeys.userId });
    return result.length;
  }
}

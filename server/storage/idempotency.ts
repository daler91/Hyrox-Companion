import { idempotencyKeys } from "@shared/schema";
import { db } from "../db";
import { and, eq, lt } from "drizzle-orm";

export interface IdempotencyRecord {
  statusCode: number;
  responseBody: unknown;
}

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
        responseBody: record.responseBody as object,
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

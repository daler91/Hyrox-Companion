import { aiUsageLogs } from "@shared/schema";
import { and, eq, gt, sql, sum } from "drizzle-orm";

import { db } from "../db";

export type AiUsageLog = typeof aiUsageLogs.$inferSelect;

export class AiUsageStorage {
  async insertUsageLog(log: {
    userId: string;
    model: string;
    feature: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostCents: number;
  }): Promise<void> {
    await db.insert(aiUsageLogs).values(log);
  }

  /** Sum estimated_cost_cents for a user over the last 24 hours. */
  async getDailyTotalCents(userId: string): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [row] = await db
      .select({ total: sum(aiUsageLogs.estimatedCostCents) })
      .from(aiUsageLogs)
      .where(
        and(
          eq(aiUsageLogs.userId, userId),
          gt(aiUsageLogs.createdAt, cutoff),
        ),
      );
    return Number(row?.total ?? 0);
  }

  /**
   * Sum estimated_cost_cents across ALL users over the last 24 hours.
   *
   * Backs the application-wide spend cap (AI_GLOBAL_DAILY_LIMIT_CENTS). The
   * per-user cap alone lets total spend scale linearly with sign-ups, so a
   * burst of new accounts costs real money with nothing to stop it.
   *
   * There is no index on created_at alone — the existing one is
   * (user_id, created_at) — so this scans. That is acceptable because the cron
   * trims the table to 7 days and `checkAiBudget` caches the result for
   * GLOBAL_TOTAL_CACHE_MS, bounding this to a couple of queries a minute per
   * replica rather than one per AI request.
   */
  async getGlobalDailyTotalCents(): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [row] = await db
      .select({ total: sum(aiUsageLogs.estimatedCostCents) })
      .from(aiUsageLogs)
      .where(gt(aiUsageLogs.createdAt, cutoff));
    return Number(row?.total ?? 0);
  }

  /** Delete logs older than the given number of days. Returns count deleted. */
  async deleteExpiredLogs(olderThanDays: number = 7): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const result = await db
      .delete(aiUsageLogs)
      .where(sql`${aiUsageLogs.createdAt} < ${cutoff}`);
    return result.rowCount ?? 0;
  }

  /**
   * Return every AI usage row for the user, oldest first. Used by the GDPR
   * data export. The cron in server/cron.ts trims this table to the last 7
   * days, so the unbounded read is naturally bounded by retention.
   */
  async listForUser(userId: string): Promise<AiUsageLog[]> {
    return await db
      .select()
      .from(aiUsageLogs)
      .where(eq(aiUsageLogs.userId, userId))
      .orderBy(aiUsageLogs.createdAt);
  }
}

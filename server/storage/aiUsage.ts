import { aiUsageLogs } from "@shared/schema";
import { and, eq, gt, sql, sum } from "drizzle-orm";

import { db } from "../db";

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

  /** Delete logs older than the given number of days. Returns count deleted. */
  async deleteExpiredLogs(olderThanDays: number = 7): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const result = await db
      .delete(aiUsageLogs)
      .where(sql`${aiUsageLogs.createdAt} < ${cutoff}`);
    return result.rowCount ?? 0;
  }
}

import { db } from "./db";
import { sql } from "drizzle-orm";
import type { IStorage } from "./storage";
import { logger } from "./logger";

async function cleanOrphanedData() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE workout_logs SET plan_day_id = NULL WHERE plan_day_id IS NOT NULL AND plan_day_id NOT IN (SELECT id FROM plan_days)`);
    });
    logger.info({ context: "db" }, "Orphaned data cleanup complete");
  } catch (error) {
    logger.info({ context: "db" }, `Orphaned data cleanup skipped: ${error}`);
  }
}

export async function runStartupMaintenance(storage: IStorage): Promise<void> {
  await cleanOrphanedData();
  try {
    const marked = await storage.markMissedPlanDays();
    if (marked > 0) logger.info({ context: "db" }, `Marked ${marked} past planned day(s) as missed`);
  } catch (error) {
    logger.info({ context: "db" }, `Mark missed days skipped: ${error}`);
  }
}

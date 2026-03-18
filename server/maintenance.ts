import { db } from "./db";
import { pool } from "./db";
import { sql } from "drizzle-orm";
import type { IStorage } from "./storage";
import { logger } from "./logger";

async function ensureSchemaUpToDate() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users' AND column_name IN ('ai_coach_enabled', 'email_notifications')`,
    );
    const columns = new Map(result.rows.map((r: { column_name: string; data_type: string }) => [r.column_name, r.data_type]));

    if (!columns.has("ai_coach_enabled")) {
      await client.query(`ALTER TABLE users ADD COLUMN ai_coach_enabled boolean DEFAULT true NOT NULL`);
      logger.info({ context: "db" }, "Added missing ai_coach_enabled column to users table");
    }

    if (columns.get("email_notifications") === "integer") {
      await client.query(`ALTER TABLE users ALTER COLUMN email_notifications DROP DEFAULT`);
      await client.query(`ALTER TABLE users ALTER COLUMN email_notifications TYPE boolean USING email_notifications::boolean`);
      await client.query(`ALTER TABLE users ALTER COLUMN email_notifications SET DEFAULT true`);
      logger.info({ context: "db" }, "Converted email_notifications column from integer to boolean");
    }
  } catch (error) {
    logger.error({ context: "db", err: error }, "Schema migration check failed");
  } finally {
    client.release();
  }
}

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
  await ensureSchemaUpToDate();
  await cleanOrphanedData();
  try {
    const marked = await storage.markMissedPlanDays();
    if (marked > 0) logger.info({ context: "db" }, `Marked ${marked} past planned day(s) as missed`);
  } catch (error) {
    logger.info({ context: "db" }, `Mark missed days skipped: ${error}`);
  }
}

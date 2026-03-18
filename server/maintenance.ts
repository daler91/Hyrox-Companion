import { db } from "./db";
import { pool } from "./db";
import { sql } from "drizzle-orm";
import type { IStorage } from "./storage";
import { logger } from "./logger";

async function ensureSchemaUpToDate() {
  let client;
  try {
    client = await pool.connect();
    const userCols = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users' AND column_name IN ('ai_coach_enabled', 'email_notifications')`,
    );
    const columns = new Map(userCols.rows.map((r: { column_name: string; data_type: string }) => [r.column_name, r.data_type]));

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

    const tpGoal = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'training_plans' AND column_name = 'goal'`,
    );
    if (tpGoal.rowCount === 0) {
      await client.query(`ALTER TABLE training_plans ADD COLUMN goal text`);
      logger.info({ context: "db" }, "Added missing goal column to training_plans table");
    }

    const isAutoCoaching = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_auto_coaching'`,
    );
    if (isAutoCoaching.rowCount === 0) {
      await client.query(`ALTER TABLE users ADD COLUMN is_auto_coaching boolean DEFAULT false`);
      logger.info({ context: "db" }, "Added missing is_auto_coaching column to users table");
    }
  } catch (error) {
    logger.error({ context: "db", err: error }, "Schema migration check failed");
  } finally {
    if (client) client.release();
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

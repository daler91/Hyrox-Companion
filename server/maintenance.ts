import { db } from "./db";
import { sql } from "drizzle-orm";
import type { IStorage } from "./storage";
import { log } from "./index";

async function cleanOrphanedData() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM exercise_sets WHERE workout_log_id NOT IN (SELECT id FROM workout_logs)`);
      await tx.execute(sql`DELETE FROM chat_messages WHERE user_id NOT IN (SELECT id FROM users)`);
      await tx.execute(sql`DELETE FROM custom_exercises WHERE user_id NOT IN (SELECT id FROM users)`);
      await tx.execute(sql`DELETE FROM strava_connections WHERE user_id NOT IN (SELECT id FROM users)`);
      await tx.execute(sql`DELETE FROM plan_days WHERE plan_id NOT IN (SELECT id FROM training_plans)`);
      await tx.execute(sql`UPDATE workout_logs SET plan_day_id = NULL WHERE plan_day_id IS NOT NULL AND plan_day_id NOT IN (SELECT id FROM plan_days)`);
      await tx.execute(sql`DELETE FROM workout_logs WHERE user_id NOT IN (SELECT id FROM users)`);
      await tx.execute(sql`DELETE FROM training_plans WHERE user_id NOT IN (SELECT id FROM users)`);
    });
    log("Orphaned data cleanup complete", "db");
  } catch (error) {
    log(`Orphaned data cleanup skipped: ${error}`, "db");
  }
}

export async function runStartupMaintenance(storage: IStorage): Promise<void> {
  await cleanOrphanedData();
  try {
    const marked = await storage.markMissedPlanDays();
    if (marked > 0) log(`Marked ${marked} past planned day(s) as missed`, "db");
  } catch (error) {
    log(`Mark missed days skipped: ${error}`, "db");
  }
}

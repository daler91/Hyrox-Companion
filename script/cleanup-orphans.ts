import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set, skipping orphan cleanup");
  process.exit(0);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM exercise_sets WHERE workout_log_id NOT IN (SELECT id FROM workout_logs)`);
    await client.query(`DELETE FROM chat_messages WHERE user_id NOT IN (SELECT id FROM users)`);
    await client.query(`DELETE FROM custom_exercises WHERE user_id NOT IN (SELECT id FROM users)`);
    await client.query(`DELETE FROM strava_connections WHERE user_id NOT IN (SELECT id FROM users)`);
    await client.query(`UPDATE workout_logs SET plan_day_id = NULL WHERE plan_day_id IS NOT NULL AND plan_day_id NOT IN (SELECT id FROM plan_days)`);
    await client.query(`DELETE FROM plan_days WHERE plan_id NOT IN (SELECT id FROM training_plans)`);
    await client.query(`UPDATE workout_logs SET plan_day_id = NULL WHERE plan_day_id IS NOT NULL AND plan_day_id NOT IN (SELECT id FROM plan_days)`);
    await client.query(`DELETE FROM workout_logs WHERE user_id NOT IN (SELECT id FROM users)`);
    await client.query(`DELETE FROM training_plans WHERE user_id NOT IN (SELECT id FROM users)`);
    await client.query("COMMIT");
    console.log("Orphaned data cleanup complete");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Orphaned data cleanup failed:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

cleanup();

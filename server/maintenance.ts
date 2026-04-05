import { db, pool } from "./db";
import { vectorPool } from "./vectorDb";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import type { IStorage } from "./storage";
import { logger } from "./logger";
import { EMBEDDING_DIMENSIONS } from "./gemini/client";

async function ensurePgvectorExtension() {
  let client;
  try {
    client = await vectorPool.connect();
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    logger.info({ context: "db" }, "pgvector extension ensured on vector DB");
  } catch (error) {
    logger.warn(
      { context: "db", err: error },
      "Could not enable pgvector extension on vector DB (may already exist or lack permissions)",
    );
  } finally {
    if (client) client.release();
  }
}

async function ensureSchemaUpToDate() {
  if (process.env.NODE_ENV === "test") {
    logger.info({ context: "db" }, "Skipping programmatic schema additions in test environment");
    return;
  }

  let client;
  try {
    client = await pool.connect();
    const userCols = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users' AND column_name IN ('ai_coach_enabled', 'email_notifications')`,
    );
    const columns = new Map(
      userCols.rows.map((r: { column_name: string; data_type: string }) => [
        r.column_name,
        r.data_type,
      ]),
    );

    if (!columns.has("ai_coach_enabled")) {
      await client.query(
        `ALTER TABLE users ADD COLUMN ai_coach_enabled boolean DEFAULT true NOT NULL`,
      );
      logger.info({ context: "db" }, "Added missing ai_coach_enabled column to users table");
    }

    if (columns.get("email_notifications") === "integer") {
      await client.query(`ALTER TABLE users ALTER COLUMN email_notifications DROP DEFAULT`);
      await client.query(
        `ALTER TABLE users ALTER COLUMN email_notifications TYPE boolean USING email_notifications::boolean`,
      );
      await client.query(`ALTER TABLE users ALTER COLUMN email_notifications SET DEFAULT true`);
      logger.info(
        { context: "db" },
        "Converted email_notifications column from integer to boolean",
      );
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

    const aiSource = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'plan_days' AND column_name = 'ai_source'`,
    );
    if (aiSource.rowCount === 0) {
      await client.query(`ALTER TABLE plan_days ADD COLUMN ai_source text`);
      logger.info({ context: "db" }, "Added missing ai_source column to plan_days table");
    }

    const coachingTable = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'coaching_materials'`,
    );
    if (coachingTable.rowCount === 0) {
      await client.query(`
        CREATE TABLE "coaching_materials" (
          "id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "user_id" varchar(255) NOT NULL,
          "title" text NOT NULL,
          "content" text NOT NULL,
          "type" varchar(50) DEFAULT 'principles' NOT NULL,
          "created_at" timestamp DEFAULT now(),
          "updated_at" timestamp DEFAULT now()
        )
      `);
      await client.query(`
        ALTER TABLE "coaching_materials" ADD CONSTRAINT "coaching_materials_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
      `);
      await client.query(`
        CREATE INDEX "idx_coaching_materials_user_id" ON "coaching_materials" USING btree ("user_id")
      `);
      logger.info({ context: "db" }, "Created missing coaching_materials table");
    }
    // document_chunks table is now on the vector DB — see ensureVectorSchema()
  } catch (error) {
    logger.error({ context: "db", err: error }, "Schema migration check failed");
  } finally {
    if (client) client.release();
  }
}

async function cleanOrphanedData() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`UPDATE workout_logs SET plan_day_id = NULL WHERE plan_day_id IS NOT NULL AND plan_day_id NOT IN (SELECT id FROM plan_days)`,
      );
    });
    logger.info({ context: "db" }, "Orphaned data cleanup complete");
  } catch (error) {
    logger.warn({ context: "db", err: error }, "Orphaned data cleanup skipped");
  }
}

async function runDrizzleMigrations() {
  if (process.env.NODE_ENV === "test") {
    logger.info({ context: "db" }, "Skipping programmatic Drizzle migrations in test environment");
    return;
  }

  try {
    const migrationsFolder = path.resolve(import.meta.dirname, "..", "migrations");
    logger.info({ context: "db", migrationsFolder }, "Running Drizzle migrations...");
    await migrate(db, { migrationsFolder });
    logger.info({ context: "db" }, "Drizzle migrations applied successfully");
  } catch (error) {
    // In CI/production, drizzle-kit push is used to manage the schema, so
    // migration failures (e.g. "already exists") are expected and non-fatal.
    const errStr = String((error as { message?: string })?.message ?? error);
    if (errStr.includes("already exists")) {
      logger.info(
        { context: "db" },
        "Drizzle migrations skipped — schema already up to date (drizzle-kit push was used)",
      );
    } else {
      logger.warn(
        { context: "db", err: error },
        "Drizzle migration failed (non-fatal, continuing startup)",
      );
    }
  }
}

async function ensureVectorSchema() {
  if (process.env.NODE_ENV === "test") {
    logger.info(
      { context: "db" },
      "Skipping programmatic vector schema additions in test environment",
    );
    return;
  }

  let client;
  try {
    client = await vectorPool.connect();
    const chunksTable = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'document_chunks'`,
    );
    if (chunksTable.rowCount === 0) {
      await client.query(`
        CREATE TABLE "document_chunks" (
          "id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "material_id" varchar(255) NOT NULL,
          "user_id" varchar(255) NOT NULL,
          "content" text NOT NULL,
          "chunk_index" integer NOT NULL,
          "embedding" vector(${EMBEDDING_DIMENSIONS}),
          "created_at" timestamp DEFAULT now()
        )
      `);
      await client.query(`
        CREATE INDEX "idx_document_chunks_material_id" ON "document_chunks" USING btree ("material_id")
      `);
      await client.query(`
        CREATE INDEX "idx_document_chunks_user_id" ON "document_chunks" USING btree ("user_id")
      `);
      logger.info({ context: "db" }, "Created document_chunks table on vector DB");
    }

    // Ensure the embedding column uses native vector type (not text)
    const embCol = await client.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'document_chunks' AND column_name = 'embedding'`,
    );
    if (embCol.rows.length > 0 && (embCol.rows[0] as { data_type: string }).data_type === "text") {
      await client.query(
        `ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(${EMBEDDING_DIMENSIONS}) USING embedding::vector(${EMBEDDING_DIMENSIONS})`,
      );
      logger.info(
        { context: "db", dimensions: EMBEDDING_DIMENSIONS },
        "Converted embedding column from text to vector type",
      );
    }
  } catch (error) {
    logger.error({ context: "db", err: error }, "Vector schema setup failed");
  } finally {
    if (client) client.release();
  }
}

async function testDatabaseConnection() {
  logger.info({ context: "db" }, "Testing database connection...");
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(
            "Database connection timed out after 15s — check DATABASE_URL and network connectivity",
          ),
        ),
      15000,
    ),
  );
  let client;
  try {
    client = await Promise.race([pool.connect(), timeout]);
    await client.query("SELECT 1 as ok");
    logger.info({ context: "db" }, "Database connection successful");
  } catch (error) {
    logger.fatal({ context: "db", err: error }, "Cannot connect to database — app cannot start");
    throw error;
  } finally {
    if (client) client.release();
  }
}

async function backfillPlanDatesAndWorkoutLinks() {
  let client;
  try {
    client = await pool.connect();

    const backfillQueries: Array<{ query: string; label: string }> = [
      {
        label: "Backfilled start/end dates on training plans",
        query: `UPDATE training_plans tp
              SET start_date = sub.min_date, end_date = sub.max_date
              FROM (
                SELECT plan_id, MIN(scheduled_date) AS min_date, MAX(scheduled_date) AS max_date
                FROM plan_days WHERE scheduled_date IS NOT NULL GROUP BY plan_id
              ) sub
              WHERE tp.id = sub.plan_id AND tp.start_date IS NULL`,
      },
      {
        label: "Backfilled planId on workout logs from planDayId",
        query: `UPDATE workout_logs wl SET plan_id = pd.plan_id
              FROM plan_days pd
              WHERE wl.plan_day_id = pd.id AND wl.plan_id IS NULL`,
      },
      {
        label: "Backfilled planId on standalone workout logs from plan date ranges",
        // DISTINCT ON picks one plan per workout (latest end_date) to handle overlapping ranges
        query: `UPDATE workout_logs wl SET plan_id = best.plan_id
              FROM (
                SELECT DISTINCT ON (wl2.id) wl2.id AS workout_id, tp.id AS plan_id
                FROM workout_logs wl2
                JOIN training_plans tp
                  ON wl2.user_id = tp.user_id
                 AND tp.start_date IS NOT NULL AND tp.end_date IS NOT NULL
                 AND wl2.date >= tp.start_date AND wl2.date <= tp.end_date
                WHERE wl2.plan_id IS NULL AND wl2.plan_day_id IS NULL
                ORDER BY wl2.id, tp.end_date DESC
              ) best
              WHERE wl.id = best.workout_id`,
      },
    ];

    for (const { query, label } of backfillQueries) {
      const result = await client.query(query);
      if (result.rowCount && result.rowCount > 0) {
        logger.info({ context: "db", count: result.rowCount }, label);
      }
    }
  } catch (error) {
    logger.warn({ context: "db", err: error }, "Plan dates/workout links backfill skipped");
  } finally {
    if (client) client.release();
  }
}

export async function runStartupMaintenance(storage: IStorage): Promise<void> {
  logger.info({ context: "db" }, "Starting startup maintenance...");
  await testDatabaseConnection();
  await runDrizzleMigrations();
  await ensureSchemaUpToDate();
  await ensurePgvectorExtension();
  await ensureVectorSchema();
  await cleanOrphanedData();
  await backfillPlanDatesAndWorkoutLinks();
  try {
    const marked = await storage.markMissedPlanDays();
    if (marked > 0)
      logger.info({ context: "db" }, `Marked ${marked} past planned day(s) as missed`);
  } catch (error) {
    logger.warn({ context: "db", err: error }, "Mark missed days skipped");
  }
}

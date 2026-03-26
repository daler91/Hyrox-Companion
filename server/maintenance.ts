import { db, pool } from "./db";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import type { IStorage } from "./storage";
import { logger } from "./logger";

async function ensurePgvectorExtension() {
  let client;
  try {
    client = await pool.connect();
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    logger.info({ context: "db" }, "pgvector extension ensured");
  } catch (error) {
    logger.warn({ context: "db", err: error }, "Could not enable pgvector extension (may already exist or lack permissions)");
  } finally {
    if (client) client.release();
  }
}

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
          "embedding" text,
          "created_at" timestamp DEFAULT now()
        )
      `);
      await client.query(`
        ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_material_id_coaching_materials_id_fk"
          FOREIGN KEY ("material_id") REFERENCES "public"."coaching_materials"("id") ON DELETE cascade ON UPDATE no action
      `);
      await client.query(`
        ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
      `);
      await client.query(`
        CREATE INDEX "idx_document_chunks_material_id" ON "document_chunks" USING btree ("material_id")
      `);
      await client.query(`
        CREATE INDEX "idx_document_chunks_user_id" ON "document_chunks" USING btree ("user_id")
      `);
      logger.info({ context: "db" }, "Created missing document_chunks table");
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

async function runDrizzleMigrations() {
  try {
    const migrationsFolder = path.resolve(import.meta.dirname, "..", "migrations");
    logger.info({ context: "db", migrationsFolder }, "Running Drizzle migrations...");
    await migrate(db, { migrationsFolder });
    logger.info({ context: "db" }, "Drizzle migrations applied successfully");
  } catch (error) {
    logger.error({ context: "db", err: error }, "Drizzle migration failed");
    throw error;
  }
}

async function testDatabaseConnection() {
  logger.info({ context: "db" }, "Testing database connection...");
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Database connection timed out after 15s — check DATABASE_URL and network connectivity")), 15000),
  );
  let client;
  try {
    client = await Promise.race([pool.connect(), timeout]);
    const result = await client.query("SELECT 1 as ok");
    logger.info({ context: "db" }, "Database connection successful");
  } catch (error) {
    logger.fatal({ context: "db", err: error }, "Cannot connect to database — app cannot start");
    throw error;
  } finally {
    if (client) client.release();
  }
}

export async function runStartupMaintenance(storage: IStorage): Promise<void> {
  logger.info({ context: "db" }, "Starting startup maintenance...");
  await testDatabaseConnection();
  await ensurePgvectorExtension();
  await runDrizzleMigrations();
  await ensureSchemaUpToDate();
  await cleanOrphanedData();
  try {
    const marked = await storage.markMissedPlanDays();
    if (marked > 0) logger.info({ context: "db" }, `Marked ${marked} past planned day(s) as missed`);
  } catch (error) {
    logger.info({ context: "db" }, `Mark missed days skipped: ${error}`);
  }
}

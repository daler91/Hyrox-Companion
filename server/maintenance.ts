import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { pool } from "./db";
import { EMBEDDING_DIMENSIONS } from "./gemini/client";
import { logger } from "./logger";
import type { IStorage } from "./storage";
import { vectorPool } from "./vectorDb";

async function ensurePgvectorExtension() {
  let client;
  try {
    client = await vectorPool.connect();
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    logger.info({ context: "db" }, "pgvector extension ensured on vector DB");
  } catch (error) {
    logger.warn({ context: "db", err: error }, "Could not enable pgvector extension on vector DB (may already exist or lack permissions)");
  } finally {
    if (client) client.release();
  }
}

async function runDrizzleMigrations() {
  try {
    const migrationsFolder = path.resolve(import.meta.dirname, "..", "migrations");
    logger.info({ context: "db", migrationsFolder }, "Running Drizzle migrations...");
    // Use a local pool-bound client for migrations. We avoid using the app's
    // `db` export here because it's bound to the full schema; the migrator only
    // needs a minimal drizzle client.
    const migrator = drizzle(pool);
    await migrate(migrator, { migrationsFolder });
    logger.info({ context: "db" }, "Drizzle migrations applied successfully");
  } catch (error) {
    // In CI/production, drizzle-kit push is used to manage the schema, so
    // migration failures (e.g. "already exists") are expected and non-fatal.
    const errStr = String((error as { message?: string })?.message ?? error);
    if (errStr.includes("already exists")) {
      logger.info({ context: "db" }, "Drizzle migrations skipped — schema already up to date (drizzle-kit push was used)");
    } else {
      logger.warn({ context: "db", err: error }, "Drizzle migration failed (non-fatal, continuing startup)");
    }
  }
}

/**
 * Ensure the vector DB has the `document_chunks` table with the native
 * `vector(N)` column type. This runs on the SEPARATE vector database (see
 * `vectorDb.ts`), which Drizzle migrations do NOT manage — the main
 * `migrate()` call operates on `pool` only. Keeping this code-driven setup
 * is intentional.
 */
async function ensureVectorSchema() {
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

    // Create HNSW index for fast cosine similarity search on embeddings.
    // Uses IF NOT EXISTS so it's idempotent across restarts.
    const hnswIdx = await client.query(`
      SELECT 1 FROM pg_indexes WHERE indexname = 'idx_document_chunks_embedding_hnsw'
    `);
    if (hnswIdx.rowCount === 0) {
      await client.query(`
        CREATE INDEX idx_document_chunks_embedding_hnsw
        ON document_chunks USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
      `);
      logger.info({ context: "db" }, "Created HNSW index on document_chunks.embedding");
    }

    // Ensure the embedding column uses native vector type (not text)
    const embCol = await client.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'document_chunks' AND column_name = 'embedding'`,
    );
    if (embCol.rows.length > 0 && (embCol.rows[0] as { data_type: string }).data_type === "text") {
      await client.query(`ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(${EMBEDDING_DIMENSIONS}) USING embedding::vector(${EMBEDDING_DIMENSIONS})`);
      logger.info({ context: "db", dimensions: EMBEDDING_DIMENSIONS }, "Converted embedding column from text to vector type");
    }
  } catch (error) {
    logger.error({ context: "db", err: error }, "Vector schema setup failed");
  } finally {
    if (client) client.release();
  }
}

const DB_CONNECT_MAX_RETRIES = 4;
const DB_CONNECT_BASE_DELAY_MS = 2_000;

async function testDatabaseConnection() {
  logger.info({ context: "db" }, "Testing database connection...");

  for (let attempt = 1; attempt <= DB_CONNECT_MAX_RETRIES; attempt++) {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Database connection timed out after 15s — check DATABASE_URL and network connectivity")), 15000),
    );
    let client;
    try {
      client = await Promise.race([pool.connect(), timeout]);
      await client.query("SELECT 1 as ok");
      logger.info({ context: "db" }, "Database connection successful");
      return;
    } catch (error) {
      if (attempt < DB_CONNECT_MAX_RETRIES) {
        const delay = DB_CONNECT_BASE_DELAY_MS * 2 ** (attempt - 1);
        logger.warn({ context: "db", attempt, maxRetries: DB_CONNECT_MAX_RETRIES, retryInMs: delay, err: error }, "Database connection failed, retrying...");
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        logger.fatal({ context: "db", err: error }, "Cannot connect to database after all retries — app cannot start");
        throw error;
      }
    } finally {
      if (client) client.release();
    }
  }
}

export async function runStartupMaintenance(storage: IStorage): Promise<void> {
  logger.info({ context: "db" }, "Starting startup maintenance...");
  await testDatabaseConnection();
  await runDrizzleMigrations();
  await ensurePgvectorExtension();
  await ensureVectorSchema();
  try {
    const marked = await storage.plans.markMissedPlanDays();
    if (marked > 0) logger.info({ context: "db" }, `Marked ${marked} past planned day(s) as missed`);
  } catch (error) {
    logger.warn({ context: "db", err: error }, "Mark missed days skipped");
  }
  try {
    const reset = await storage.users.resetStaleAutoCoaching();
    if (reset > 0) logger.info({ context: "db", reset }, "Reset stale isAutoCoaching flags on startup");
  } catch (error) {
    logger.warn({ context: "db", err: error }, "Reset stale isAutoCoaching skipped");
  }
}

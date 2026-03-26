import { env } from "./env";
import pg from "pg";
import { logger } from "./logger";

const { Pool } = pg;

/**
 * Separate connection pool for vector/RAG storage (Supabase).
 * Falls back to the main DATABASE_URL when VECTOR_DATABASE_URL is not set,
 * so the app works in both single-DB and split-DB configurations.
 */
const vectorUrl = env.VECTOR_DATABASE_URL || env.DATABASE_URL;

export const vectorPool = new Pool({
  connectionString: vectorUrl,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
});

export const isVectorDbSeparate = Boolean(env.VECTOR_DATABASE_URL);

logger.info(
  { context: "db", separate: isVectorDbSeparate },
  isVectorDbSeparate
    ? "Vector DB configured (separate Supabase instance)"
    : "Vector DB using main DATABASE_URL (single-DB mode)",
);

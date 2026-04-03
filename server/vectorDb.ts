import { env } from "./env";
import pg from "pg";
import { logger } from "./logger";
import { VECTOR_DB_CONNECTION_TIMEOUT_MS, DB_IDLE_TIMEOUT_MS, DB_STATEMENT_TIMEOUT_MS } from "./constants";

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
  idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: VECTOR_DB_CONNECTION_TIMEOUT_MS,
  statement_timeout: DB_STATEMENT_TIMEOUT_MS,
});

vectorPool.on("error", (err) => {
  logger.error({ err, context: "vectorDb" }, "Unexpected error on idle vector DB client");
});

export const isVectorDbSeparate = Boolean(env.VECTOR_DATABASE_URL);

logger.info(
  { context: "db", separate: isVectorDbSeparate },
  isVectorDbSeparate
    ? "Vector DB configured (separate Supabase instance)"
    : "Vector DB using main DATABASE_URL (single-DB mode)",
);

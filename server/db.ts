import { env } from "./env";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { logger } from "./logger";
import { DB_CONNECTION_TIMEOUT_MS, DB_IDLE_TIMEOUT_MS, DB_STATEMENT_TIMEOUT_MS } from "./constants";

const { Pool } = pg;

if (!env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
  statement_timeout: DB_STATEMENT_TIMEOUT_MS,
});

pool.on("error", (err) => {
  logger.error({ err, context: "db" }, "Unexpected error on idle database client");
});

export const db = drizzle(pool, { schema });

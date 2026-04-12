import * as schema from "@shared/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { DB_CONNECTION_TIMEOUT_MS, DB_IDLE_TIMEOUT_MS, DB_STATEMENT_TIMEOUT_MS } from "./constants";
import { env } from "./env";
import { logger } from "./logger";

const { Pool } = pg;

if (!env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Railway's internal Postgres (*.railway.internal) does not support SSL — traffic
// stays within Railway's private IPv6 network. Force SSL only for external hosts.
const isInternalHost = /\.railway\.internal(:|$|\/)/.test(env.DATABASE_URL);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
  statement_timeout: DB_STATEMENT_TIMEOUT_MS,
  ssl: env.NODE_ENV === "production" && !isInternalHost ? { rejectUnauthorized: true } : false,
});

pool.on("error", (err) => {
  logger.error({ err, context: "db" }, "Unexpected error on idle database client");
});

export const db = drizzle(pool, { schema });

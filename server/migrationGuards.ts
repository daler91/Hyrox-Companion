import * as schema from "@shared/schema";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import type { Pool } from "pg";

/**
 * Tables whose absence after boot-time migration means the schema is unusable
 * and the instance must not serve traffic. Kept small and stable: these have
 * existed since the earliest migrations and back every core surface.
 */
export const CRITICAL_TABLES = [
  "users",
  "workout_logs",
  "plan_days",
  "foods",
  "analytics_results",
] as const;

/**
 * Errors expected when in-process migrate() runs against a schema that
 * drizzle-kit push already manages (the CI/production source of truth):
 * the first CREATE/ALTER hits an "already exists" and the batch aborts,
 * which is a healthy no-op boot, not a failure.
 *
 * The WHOLE cause chain is inspected: drizzle-orm wraps the postgres error in
 * a DrizzleQueryError whose own message is only "Failed query: <sql>" — the
 * "relation ... already exists" detail lives in error.cause. Matching the
 * top-level message alone silently classified every push-managed boot as a
 * real failure (harmless while failures were swallowed; fatal once they
 * abort startup).
 */
function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  const message = (value as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

export function isBenignIdempotencyError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    const errStr = errorText(current).toLowerCase();
    if (
      errStr.includes("already exists") ||
      errStr.includes("duplicate key") ||
      errStr.includes("duplicate object")
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Throw if any critical table is missing. A boot that swallows a migration
 * failure and then reports healthy against an empty or partial schema is the
 * worst failure mode we have (every request 500s while the platform keeps
 * routing traffic), so this check gates readiness: the thrown error reaches
 * the startup catch in server/index.ts, which sets startupState.startupError
 * and flips both health endpoints to 503.
 */
export async function assertCriticalTablesExist(pool: Pick<Pool, "query">): Promise<void> {
  const { rows } = await pool.query<{ missing: string }>(
    `SELECT t AS missing FROM unnest($1::text[]) AS t WHERE to_regclass('public.' || t) IS NULL`,
    [[...CRITICAL_TABLES]],
  );
  if (rows.length > 0) {
    throw new Error(
      `Critical tables missing after migration: ${rows.map((r) => r.missing).join(", ")} — refusing to serve an incomplete schema`,
    );
  }
}

/**
 * Declared in the Drizzle schema but not held by the primary database:
 * document_chunks lives on the vector DB, where ensureVectorSchema
 * (server/maintenance.ts) creates it; migrations 0008-0014 are no-ops for it.
 */
const SCHEMA_CHECK_EXEMPT_TABLES: ReadonlySet<string> = new Set(["document_chunks"]);

/** Every primary-DB table the deployed code's Drizzle schema declares, with its column names. */
export function declaredSchemaColumns(): Map<string, string[]> {
  const declared = new Map<string, string[]>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const { name, columns } = getTableConfig(value);
    if (SCHEMA_CHECK_EXEMPT_TABLES.has(name)) continue;
    declared.set(name, columns.map((column) => column.name));
  }
  return declared;
}

/**
 * Throw if the database lacks a table or column the Drizzle schema declares
 * (D7, CODEBASE_ANALYSIS_2026-10-03). Production's schema changes only when
 * someone runs `drizzle-kit push` by hand, and boot-time migrate() no-ops
 * against a pushed schema, so a release that adds a column could go live
 * before the push. Every `db.select().from(table)` names each declared column,
 * so every query on that table then failed while readiness (`SELECT 1`) stayed
 * green. Like assertCriticalTablesExist, the throw reaches the startup catch in
 * server/index.ts: readiness answers 503, the deploy fails Railway's
 * healthcheck and the previous deployment keeps serving until the schema is
 * pushed. Derived from the schema rather than a list, so the next migration is
 * covered without anyone remembering to add it. Presence only, not types; a
 * column the database still has but the code no longer declares is fine.
 */
export async function assertSchemaColumnsExist(
  pool: Pick<Pool, "query">,
  declared: Map<string, string[]> = declaredSchemaColumns(),
): Promise<void> {
  const { rows } = await pool.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [[...declared.keys()]],
  );
  const present = new Map<string, Set<string>>();
  for (const { table_name: table, column_name: column } of rows) {
    const columns = present.get(table) ?? new Set<string>();
    columns.add(column);
    present.set(table, columns);
  }
  const missing = [...declared].flatMap(([table, columns]) => {
    const have = present.get(table);
    if (!have) return [`${table} (table)`];
    return columns.filter((column) => !have.has(column)).map((column) => `${table}.${column}`);
  });
  if (missing.length > 0) {
    throw new Error(
      `Database schema is behind the deployed code — missing: ${missing.join(", ")}. Run \`drizzle-kit push\` against this database, then redeploy — refusing to serve queries that would fail`,
    );
  }
}

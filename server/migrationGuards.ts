import { readFileSync } from "node:fs";
import path from "node:path";

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
 * Errors expected when in-process migrate() runs against a database built by
 * `drizzle-kit push` (CI's E2E database), whose migration ledger is empty: the
 * first CREATE/ALTER hits an "already exists" and the batch aborts, which is a
 * healthy no-op boot there. Production applies its migrations at boot, so on
 * production the same error means the batch rolled back and nothing in it
 * applied; findUnappliedMigrations below names what is left.
 *
 * The WHOLE cause chain is inspected: drizzle-orm wraps the postgres error in
 * a DrizzleQueryError whose own message is only "Failed query: <sql>" — the
 * "relation ... already exists" detail lives in error.cause. Matching the
 * top-level message alone silently classified every push-built boot as a
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

/** One `migrations/meta/_journal.json` entry: the file's tag and its `when`. */
export interface MigrationJournalEntry {
  tag: string;
  when: number;
}

export function readMigrationJournal(migrationsFolder: string): MigrationJournalEntry[] {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: MigrationJournalEntry[] };
  return journal.entries.map(({ tag, when }) => ({ tag, when }));
}

/**
 * Journal entries the ledger does not record. `skipped` are older than the
 * newest recorded entry: drizzle's migrator only runs entries newer than that
 * row, so it will never run these (0019 was one until 2026-10-07; its `when`
 * is older than 0018's). `pending` are newer: a later boot runs them unless the
 * batch keeps failing.
 */
export interface UnappliedMigrations {
  skipped: string[];
  pending: string[];
}

/**
 * Compare the journal with `drizzle.__drizzle_migrations`, which records each
 * applied entry under its journal `when` (`created_at`). Returns null when the
 * ledger is absent or empty: a database built by `drizzle-kit push` records
 * nothing, so every entry would read as unapplied.
 */
export async function findUnappliedMigrations(
  pool: Pick<Pool, "query">,
  journal: MigrationJournalEntry[],
): Promise<UnappliedMigrations | null> {
  const { rows: ledger } = await pool.query<{ present: boolean }>(
    `SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`,
  );
  if (!ledger[0]?.present) return null;
  const { rows } = await pool.query<{ created_at: string | number }>(
    `SELECT created_at FROM drizzle.__drizzle_migrations`,
  );
  if (rows.length === 0) return null;
  const recorded = new Set(rows.map((row) => Number(row.created_at)));
  const newest = Math.max(...recorded);
  const unapplied: UnappliedMigrations = { skipped: [], pending: [] };
  for (const entry of journal) {
    if (recorded.has(entry.when)) continue;
    if (entry.when <= newest) unapplied.skipped.push(entry.tag);
    else unapplied.pending.push(entry.tag);
  }
  return unapplied;
}

function describeUnapplied(unapplied: UnappliedMigrations | null): string {
  if (!unapplied) {
    return "Compare drizzle.__drizzle_migrations with migrations/meta/_journal.json to find the migration that did not run";
  }
  const parts: string[] = [];
  if (unapplied.skipped.length > 0) {
    parts.push(
      `skipped by the migrator (older than the newest ledger row, so boot never runs them): ${unapplied.skipped.join(", ")}`,
    );
  }
  if (unapplied.pending.length > 0) {
    parts.push(`not yet applied: ${unapplied.pending.join(", ")}`);
  }
  return parts.length > 0
    ? `Unapplied migrations — ${parts.join("; ")}`
    : "Every journal entry is recorded in the ledger, so the schema drifted after a migration ran";
}

/**
 * Throw if the database lacks a table or column the Drizzle schema declares
 * (D7, CODEBASE_ANALYSIS_2026-10-03). Every `db.select().from(table)` names
 * each declared column, so a missing one fails every query on that table while
 * readiness (`SELECT 1`) stays green. Production applies migrations at boot,
 * so a gap means a migration did not run: the migrator skipped it (its journal
 * `when` is out of order, as 0019's was) or its batch rolled back. `unapplied`
 * (from findUnappliedMigrations) names it in the error. Like
 * assertCriticalTablesExist, the throw reaches the startup catch in
 * server/index.ts: readiness answers 503, the deploy fails Railway's
 * healthcheck and the previous deployment keeps serving. The error does not
 * suggest `drizzle-kit push`: against production it drops objects the schema
 * does not declare (docs/operations/pending-manual-steps.md). Derived from the
 * schema rather than a list, so the next migration is covered without anyone
 * remembering to add it. Presence only, not types; a column the database still
 * has but the code no longer declares is fine.
 */
export async function assertSchemaColumnsExist(
  pool: Pick<Pool, "query">,
  unapplied: UnappliedMigrations | null = null,
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
      `Database schema is behind the deployed code — missing: ${missing.join(", ")}. ${describeUnapplied(unapplied)}. Apply that migration's SQL to this database (see docs/operations/pending-manual-steps.md), then redeploy; do not run drizzle-kit push against production. Refusing to serve queries that would fail`,
    );
  }
}

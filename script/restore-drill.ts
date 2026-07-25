/**
 * Restore-drill verifier — the mechanical half of the monthly drill in
 * docs/operations/backup-restore.md §6.
 *
 * That checklist was written to be ticked by hand, which means in practice it
 * gets ticked by hand or not at all. Everything below is a read-only query, so
 * the drill becomes: restore a backup into a throwaway database, point this at
 * it, and read the exit code.
 *
 * Usage:
 *   RESTORE_DRILL_DATABASE_URL=postgres://... pnpm ops:restore-drill
 *
 * Flags:
 *   --allow-primary   Permit running against the same URL as DATABASE_URL.
 *                     Refused by default: the drill exists to validate a
 *                     RESTORED COPY, and "it passed" against the live primary
 *                     proves nothing about the backup. (Every check is a SELECT,
 *                     so the guard is about meaning, not safety.)
 *   --json            Emit machine-readable results instead of the checklist.
 *
 * Optional env:
 *   ENCRYPTION_KEY    When set, one Strava/Garmin ciphertext is actually
 *                     decrypted — the §6 item that proves key + ciphertext
 *                     survived the restore together. Skipped (not failed) when
 *                     absent, so the drill is useful without handling secrets.
 *
 * Exit code is 0 only if every check passed or was skipped.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import * as schema from "@shared/schema";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import pg from "pg";

export type CheckStatus = "pass" | "fail" | "warn" | "skip";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

/** The subset of `pg.Client` the checks need — a plain seam for tests. */
export interface Queryable {
  query: <R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ) => Promise<{ rows: R[]; rowCount: number | null }>;
}

/** Tables whose emptiness after a restore means the restore did not work. */
const SPOT_CHECK_TABLES = ["users", "workout_logs", "training_plans"] as const;

/**
 * Known "NULL owner" shapes. Both were live GDPR leaks (rows with a deleted
 * owner staying visible to everyone) whose row cleanup lives in a migration
 * that push-managed production never applies — see
 * docs/operations/pending-manual-steps.md. Checking them here means the drill
 * doubles as the verification step for those outstanding manual DELETEs.
 */
const NULL_OWNER_PROBES: { name: string; sql: string }[] = [
  {
    name: "foods: no ownerless private custom rows (0081)",
    sql: `SELECT count(*)::int AS n FROM foods
          WHERE source = 'custom' AND created_by_user_id IS NULL AND NOT is_public`,
  },
  {
    name: "backfill reviews: no NULL user_id rows (0082)",
    sql: `SELECT count(*)::int AS n FROM structured_exercise_backfill_reviews WHERE user_id IS NULL`,
  },
];

function schemaTableNames(): string[] {
  // Loop rather than .filter() with a type predicate: the barrel's exports are
  // a wide union (zod schemas, const tuples, numbers), and `is()` narrows in
  // statement position but cannot be written as `v is PgTable` against it.
  // Same idiom as shared/schema/tables.cascade.test.ts.
  const names: string[] = [];
  for (const exported of Object.values(schema)) {
    if (!is(exported, PgTable)) continue;
    names.push(getTableName(exported));
  }
  return names.sort();
}

function journalEntryCount(): number {
  const journalPath = path.resolve(import.meta.dirname, "..", "migrations", "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] };
  return journal.entries.length;
}

async function checkConnectivity(client: Queryable): Promise<CheckResult> {
  const { rows } = await client.query<{ v: string }>("SELECT version() AS v");
  return { name: "Connects and answers a query", status: "pass", detail: rows[0]?.v?.split(",")[0] ?? "connected" };
}

/**
 * §6: "Drizzle journal is at the expected version".
 *
 * A push-managed database has no `__drizzle_migrations` ledger at all, and
 * production IS push-managed — so a missing ledger is the expected shape of a
 * production restore, not a failure. Report it distinctly instead.
 */
async function checkMigrationLedger(client: Queryable): Promise<CheckResult> {
  const expected = journalEntryCount();
  for (const table of ["drizzle.__drizzle_migrations", "public.__drizzle_migrations"]) {
    let applied: number;
    try {
      const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      applied = rows[0]?.n ?? 0;
    } catch {
      continue; // table absent — try the other location
    }
    if (applied === expected) {
      return { name: "Migration ledger matches the journal", status: "pass", detail: `${applied}/${expected} applied (${table})` };
    }
    return {
      name: "Migration ledger matches the journal",
      status: "fail",
      detail: `${applied} applied but the journal has ${expected} entries (${table}) — the restore predates the deployed code`,
    };
  }
  return {
    name: "Migration ledger matches the journal",
    status: "warn",
    detail: `no __drizzle_migrations table — expected for a drizzle-kit push-managed database (production). Rely on the schema-completeness check below.`,
  };
}

/**
 * The check that actually matters for a push-managed restore: does the restored
 * database have every table the deployed code expects? This is what "the
 * journal is at the right version" is a proxy for, and unlike the journal it
 * works regardless of how the schema got there.
 */
async function checkSchemaCompleteness(client: Queryable): Promise<CheckResult> {
  const expected = schemaTableNames();
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  const present = new Set(rows.map((r) => r.table_name));
  // document_chunks / food_embeddings live on the vector DB in split-DB mode,
  // so their absence here is not evidence of a bad primary restore.
  const vectorOnly = new Set(["document_chunks", "food_embeddings"]);
  const missing = expected.filter((t) => !present.has(t) && !vectorOnly.has(t));
  if (missing.length > 0) {
    return {
      name: "Every table in the deployed schema exists",
      status: "fail",
      detail: `${missing.length} missing: ${missing.join(", ")}`,
    };
  }
  return {
    name: "Every table in the deployed schema exists",
    status: "pass",
    detail: `${expected.length - vectorOnly.size} primary-DB tables present`,
  };
}

async function checkRowCounts(client: Queryable): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const table of SPOT_CHECK_TABLES) {
    let n: number;
    try {
      const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`);
      n = rows[0]?.n ?? 0;
    } catch (err) {
      results.push({ name: `Row count: ${table}`, status: "fail", detail: err instanceof Error ? err.message : String(err) });
      continue;
    }
    // An empty `users` is the signature of a restore that created the schema
    // but never loaded the dump — the failure this drill most needs to catch.
    results.push({
      name: `Row count: ${table}`,
      status: table === "users" && n === 0 ? "fail" : "pass",
      detail: `${n} row(s)${table === "users" && n === 0 ? " — an empty users table means no data was restored" : ""}`,
    });
  }
  return results;
}

interface ForeignKeyRef {
  constraint: string;
  child: string;
  parent: string;
  childCols: string[];
  parentCols: string[];
}

/** Every FK in the public schema, read from the catalog rather than hardcoded. */
export async function listForeignKeys(client: Queryable): Promise<ForeignKeyRef[]> {
  const { rows } = await client.query<{
    constraint: string; child: string; parent: string; child_cols: string[]; parent_cols: string[];
  }>(`
    SELECT con.conname AS constraint,
           src.relname AS child,
           tgt.relname AS parent,
           -- ::text is load-bearing: attname has type "name", for which node-pg
           -- has no array parser, so name[] would arrive as a raw string.
           (SELECT array_agg(a.attname::text ORDER BY u.ord)
              FROM unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.attnum) AS child_cols,
           -- ::text is load-bearing: attname has type "name", for which node-pg
           -- has no array parser, so name[] would arrive as a raw string.
           (SELECT array_agg(a.attname::text ORDER BY u.ord)
              FROM unnest(con.confkey) WITH ORDINALITY AS u(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = u.attnum) AS parent_cols
      FROM pg_constraint con
      JOIN pg_class src ON src.oid = con.conrelid
      JOIN pg_class tgt ON tgt.oid = con.confrelid
      JOIN pg_namespace ns ON ns.oid = src.relnamespace
     WHERE con.contype = 'f' AND ns.nspname = 'public'
     ORDER BY src.relname, con.conname
  `);
  return rows.map((r) => ({
    constraint: r.constraint,
    child: r.child,
    parent: r.parent,
    childCols: r.child_cols,
    parentCols: r.parent_cols,
  }));
}

/**
 * Orphan probe for one FK. NULL child keys are skipped rather than counted:
 * a nullable FK holding NULL is a legal unset reference, not an orphan.
 */
export function buildOrphanQuery(fk: ForeignKeyRef): string {
  const notNull = fk.childCols.map((c) => `c."${c}" IS NOT NULL`).join(" AND ");
  const join = fk.childCols.map((c, i) => `p."${fk.parentCols[i]}" = c."${c}"`).join(" AND ");
  return `SELECT count(*)::int AS n FROM "${fk.child}" c
           WHERE ${notNull}
             AND NOT EXISTS (SELECT 1 FROM "${fk.parent}" p WHERE ${join})`;
}

/**
 * §6: "FK integrity holds (no orphan rows; cascade chains intact)". Postgres
 * enforces this on writes, but `pg_restore --disable-triggers`, a partial
 * restore, or a dump taken mid-cascade can all land rows whose parent is gone.
 */
async function checkForeignKeyIntegrity(client: Queryable): Promise<CheckResult> {
  const fks = await listForeignKeys(client);
  if (fks.length === 0) {
    return { name: "No orphaned rows across any foreign key", status: "fail", detail: "no foreign keys found at all — the schema is not what the app expects" };
  }
  const broken: string[] = [];
  for (const fk of fks) {
    const { rows } = await client.query<{ n: number }>(buildOrphanQuery(fk));
    const n = rows[0]?.n ?? 0;
    if (n > 0) broken.push(`${fk.child}.${fk.childCols.join("+")} → ${fk.parent} (${n})`);
  }
  return broken.length > 0
    ? { name: "No orphaned rows across any foreign key", status: "fail", detail: broken.join("; ") }
    : { name: "No orphaned rows across any foreign key", status: "pass", detail: `${fks.length} foreign key(s) checked` };
}

async function checkNullOwnerLeaks(client: Queryable): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const probe of NULL_OWNER_PROBES) {
    try {
      const { rows } = await client.query<{ n: number }>(probe.sql);
      const n = rows[0]?.n ?? 0;
      results.push({
        name: probe.name,
        status: n === 0 ? "pass" : "fail",
        detail: n === 0 ? "0 rows" : `${n} ownerless row(s) — run the matching DELETE in docs/operations/pending-manual-steps.md`,
      });
    } catch (err) {
      results.push({ name: probe.name, status: "fail", detail: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

/**
 * §6: "A known user's Strava/Garmin credential decrypts with the production
 * ENCRYPTION_KEY". Proves key and ciphertext survived the restore *together* —
 * a restore with a mismatched key looks perfect until the first sync.
 */
async function checkCredentialDecrypt(client: Queryable): Promise<CheckResult> {
  const name = "A stored credential decrypts with the configured key";
  if (!process.env.ENCRYPTION_KEY) {
    return { name, status: "skip", detail: "ENCRYPTION_KEY not set in this shell — export the key used by the source deployment to run this check" };
  }
  const { rows } = await client.query<{ ciphertext: string }>(
    `SELECT access_token AS ciphertext FROM strava_connections WHERE access_token IS NOT NULL LIMIT 1`,
  );
  const ciphertext = rows[0]?.ciphertext;
  if (!ciphertext) {
    return { name, status: "skip", detail: "no Strava connections in the restored data to test against" };
  }
  // Imported lazily: server/crypto.ts reads the keyring from env at load time,
  // and the whole script must stay usable with no ENCRYPTION_KEY set. The
  // import itself can fail — crypto.ts pulls in server/env.ts, which validates
  // the entire server env and throws — so a missing variable degrades this one
  // check to a skip instead of aborting the drill.
  let decryptToken: (value: string) => string;
  try {
    ({ decryptToken } = await import("../server/crypto"));
  } catch (err) {
    return { name, status: "skip", detail: `could not load server/crypto: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` };
  }
  try {
    const plaintext = decryptToken(ciphertext);
    return plaintext.length > 0
      ? { name, status: "pass", detail: "decrypted a Strava access token (plaintext not logged)" }
      : { name, status: "fail", detail: "decrypted to an empty string" };
  } catch (err) {
    return { name, status: "fail", detail: `decrypt failed — ENCRYPTION_KEY does not match the ciphertext: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function runRestoreDrill(client: Queryable): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  results.push(await checkConnectivity(client));
  results.push(await checkMigrationLedger(client));
  results.push(await checkSchemaCompleteness(client));
  results.push(...(await checkRowCounts(client)));
  results.push(await checkForeignKeyIntegrity(client));
  results.push(...(await checkNullOwnerLeaks(client)));
  results.push(await checkCredentialDecrypt(client));
  return results;
}

export function formatReport(results: CheckResult[], elapsedMs: number): string {
  const glyph: Record<CheckStatus, string> = { pass: "[ok]  ", fail: "[FAIL]", warn: "[warn]", skip: "[skip]" };
  const lines = results.map((r) => `${glyph[r.status]} ${r.name}\n         ${r.detail}`);
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  lines.push("");
  lines.push(
    failed === 0
      ? `Restore drill PASSED — ${results.length - skipped} check(s) verified, ${skipped} skipped, ${(elapsedMs / 1000).toFixed(1)}s.`
      : `Restore drill FAILED — ${failed} of ${results.length} check(s) failed, ${(elapsedMs / 1000).toFixed(1)}s.`,
  );
  // §6's last item: compare the wall clock against the documented RTO.
  lines.push("Record this run (date, operator, wall-clock vs RTO) in docs/operations/backup-restore.md §6.");
  return lines.join("\n");
}

export function hasFailure(results: CheckResult[]): boolean {
  return results.some((r) => r.status === "fail");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const target = process.env.RESTORE_DRILL_DATABASE_URL;
  if (!target) {
    console.error(
      "RESTORE_DRILL_DATABASE_URL is not set.\n" +
      "Restore a backup into a throwaway database first, then:\n" +
      "  RESTORE_DRILL_DATABASE_URL=postgres://... pnpm ops:restore-drill",
    );
    process.exit(2);
  }
  if (target === process.env.DATABASE_URL && !argv.includes("--allow-primary")) {
    console.error(
      "RESTORE_DRILL_DATABASE_URL equals DATABASE_URL.\n" +
      "The drill validates a RESTORED COPY — passing against the live primary proves\n" +
      "nothing about the backup. Point it at the throwaway restore, or pass\n" +
      "--allow-primary to audit the primary's integrity deliberately.",
    );
    process.exit(2);
  }

  // The credential check imports server/crypto.ts, which pulls in server/env.ts
  // and validates the WHOLE server env at load — including DATABASE_URL, which
  // crypto itself never touches. Default it to the drill target so an operator
  // only has to export the one variable the check actually needs
  // (ENCRYPTION_KEY). Nothing in this script opens a pool from DATABASE_URL.
  process.env.DATABASE_URL ??= target;

  const startedAt = Date.now();
  const pool = new pg.Pool({ connectionString: target, max: 2, connectionTimeoutMillis: 10_000 });
  const client = await pool.connect();
  try {
    const results = await runRestoreDrill(client);
    if (argv.includes("--json")) {
      console.log(JSON.stringify({ results, elapsedMs: Date.now() - startedAt }, null, 2));
    } else {
      console.log(formatReport(results, Date.now() - startedAt));
    }
    if (hasFailure(results)) process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

// Importing this module (for tests) must not run the drill.
if (process.argv[1]?.endsWith("restore-drill.ts")) {
  await main();
}

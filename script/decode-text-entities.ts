/**
 * One-shot backfill: decode HTML entities in text columns that feed React as
 * plain text.
 *
 * We used to wrap AI-generated strings through `server/utils/sanitize.ts` →
 * `sanitizeHtml()` before writing them to the DB. That helper encodes
 * `'` → `&#39;`, `"` → `&quot;`, `<` → `&lt;`, `>` → `&gt;`. The client
 * renders these fields with `{rationale}` / `{focus}` / etc. — which React
 * already escapes — so the pre-encoded entities leaked into the UI as
 * literal characters (users saw `You&#39;ve crushed` instead of
 * `You've crushed`).
 *
 * The write path has been fixed (sanitizeHtml() no longer runs on React-text
 * fields). This script decodes the already-corrupted rows in-place.
 *
 * Columns touched:
 *   plan_days:     focus, main_workout, accessory, notes, ai_rationale
 *   workout_logs:  focus, main_workout, accessory, notes
 *   exercise_sets: exercise_name, custom_label, category
 *
 * Usage:
 *   pnpm tsx script/decode-text-entities.ts            # live run
 *   pnpm tsx script/decode-text-entities.ts --dry-run  # report counts, no writes
 *
 * Idempotent: rows with no entities to decode are untouched. Safe to re-run.
 */

import { sql } from "drizzle-orm";

import { db } from "../server/db";
import { logger } from "../server/logger";

// Entities we know we wrote via sanitizeHtml. Order matters: `&amp;` must
// decode LAST so a literal `&amp;amp;` (double-encoded) collapses correctly
// without eating the trailing `amp;`.
const ENTITY_REPLACEMENTS: ReadonlyArray<[entity: string, literal: string]> = [
  ["&#39;", "'"],
  ["&quot;", '"'],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&amp;", "&"],
];

interface ColumnTarget {
  readonly table: string;
  readonly columns: readonly string[];
}

const TARGETS: readonly ColumnTarget[] = [
  { table: "plan_days", columns: ["focus", "main_workout", "accessory", "notes", "ai_rationale"] },
  { table: "workout_logs", columns: ["focus", "main_workout", "accessory", "notes"] },
  { table: "exercise_sets", columns: ["exercise_name", "custom_label", "category"] },
];

interface Flags {
  readonly dryRun: boolean;
}

function parseFlags(argv: readonly string[]): Flags {
  return { dryRun: argv.includes("--dry-run") };
}

// Build a REPLACE chain: REPLACE(REPLACE(col, '&#39;', ''''), '&quot;', '"') ...
// Drizzle's sql tag handles identifier/literal escaping.
function buildDecodeExpr(column: string) {
  let expr = sql.raw(`"${column}"`);
  for (const [entity, literal] of ENTITY_REPLACEMENTS) {
    expr = sql`REPLACE(${expr}, ${entity}, ${literal})`;
  }
  return expr;
}

// True when any entity appears in any of the columns. Used both as a WHERE
// filter (only touch rows that need it) and to compute dry-run counts.
function buildNeedsDecodeCondition(columns: readonly string[]) {
  const patterns = ENTITY_REPLACEMENTS.map(([e]) => `%${e}%`);
  const perColumn = columns.map((col) => {
    const likes = patterns.map((p) => sql`"${sql.raw(col)}" LIKE ${p}`);
    return sql.join(likes, sql` OR `);
  });
  return sql.join(perColumn, sql` OR `);
}

async function countNeedingDecode(target: ColumnTarget): Promise<number> {
  const cond = buildNeedsDecodeCondition(target.columns);
  const query = sql`SELECT COUNT(*)::int AS c FROM ${sql.raw(target.table)} WHERE ${cond}`;
  const result = await db.execute(query);
  // node-postgres drizzle returns { rows: [...] }
  const row = (result as unknown as { rows: Array<{ c: number }> }).rows[0];
  return row?.c ?? 0;
}

async function decodeTable(target: ColumnTarget, dryRun: boolean): Promise<{ updated: number; needed: number }> {
  const needed = await countNeedingDecode(target);
  if (dryRun) {
    return { updated: 0, needed };
  }
  if (needed === 0) {
    return { updated: 0, needed };
  }

  const setClauses = target.columns.map((col) => sql`"${sql.raw(col)}" = ${buildDecodeExpr(col)}`);
  const setExpr = sql.join(setClauses, sql`, `);
  const cond = buildNeedsDecodeCondition(target.columns);

  const query = sql`UPDATE ${sql.raw(target.table)} SET ${setExpr} WHERE ${cond}`;
  const result = await db.execute(query);
  // rowCount on pg result
  const rowCount = (result as unknown as { rowCount: number }).rowCount ?? 0;
  return { updated: rowCount, needed };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  logger.info({ dryRun: flags.dryRun }, "[decode-entities] starting");

  const summary: Record<string, { updated: number; needed: number }> = {};

  for (const target of TARGETS) {
    const res = await decodeTable(target, flags.dryRun);
    summary[target.table] = res;
    logger.info({ table: target.table, ...res, dryRun: flags.dryRun }, "[decode-entities] table processed");
  }

  logger.info({ summary, dryRun: flags.dryRun }, "[decode-entities] done");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "[decode-entities] fatal");
  process.exit(1);
});

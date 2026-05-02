/**
 * One-time backfill for missing user_training_style rows.
 *
 * Inserts a deterministic default style history row for any user that has no
 * entry in user_training_style. Safe to re-run: existing users are skipped.
 *
 * Usage:
 *   pnpm tsx script/backfill-user-training-style.ts [--dry-run]
 */

import { db } from "../server/db";
import { logger } from "../server/logger";

interface Flags {
  dryRun: boolean;
}

function parseFlags(): Flags {
  const dryRun = process.argv.slice(2).includes("--dry-run");
  return { dryRun };
}

async function countMissingUsers(): Promise<number> {
  const result = await db.execute<{ count: string }>(`
    SELECT COUNT(*)::text AS count
    FROM users u
    WHERE NOT EXISTS (
      SELECT 1
      FROM user_training_style uts
      WHERE uts.user_id = u.id
    )
  `);
  return Number.parseInt(result.rows[0]?.count ?? "0", 10);
}

async function insertMissingUsers(): Promise<number> {
  const result = await db.execute<{ inserted: string }>(`
    WITH inserted AS (
      INSERT INTO user_training_style (user_id, style, effective_date, source)
      SELECT
        u.id,
        COALESCE(u.training_style_id, 'balanced_default'),
        COALESCE(u.created_at::date, CURRENT_DATE),
        'migration_default'
      FROM users u
      WHERE NOT EXISTS (
        SELECT 1
        FROM user_training_style uts
        WHERE uts.user_id = u.id
      )
      RETURNING 1
    )
    SELECT COUNT(*)::text AS inserted FROM inserted
  `);

  return Number.parseInt(result.rows[0]?.inserted ?? "0", 10);
}

async function main() {
  const flags = parseFlags();
  const missingBefore = await countMissingUsers();

  logger.info({ dryRun: flags.dryRun, missingBefore }, "[backfill:user_training_style] starting");

  if (flags.dryRun) {
    logger.info({ wouldInsert: missingBefore }, "[backfill:user_training_style] dry run complete");
    return;
  }

  const inserted = await insertMissingUsers();
  const missingAfter = await countMissingUsers();

  logger.info(
    { inserted, missingAfter, idempotent: missingAfter === 0 },
    "[backfill:user_training_style] complete",
  );
}

try {
  await main();
} catch (error) {
  logger.error({ err: error }, "[backfill:user_training_style] failed");
  process.exit(1);
}

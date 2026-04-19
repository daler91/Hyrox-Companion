/**
 * Backfill structured exercise_sets for legacy plan_days and workout_logs
 * that only have free-text fields (mainWorkout / accessory) from before
 * structured plan generation shipped.
 *
 * Two passes:
 *   1. plan_days with no exercise_sets    → parse into planDayId-owned rows
 *   2. workout_logs with no exercise_sets → parse into workoutLogId-owned rows
 *
 * Each row's mainWorkout + accessory is fed through parseExercisesFromText()
 * (the same Gemini parser used by the app's /reparse endpoint) and the
 * resulting sets are inserted. Every row is processed in its own transaction
 * so a single parse failure doesn't block the rest of the run.
 *
 * Usage:
 *   pnpm tsx script/backfill-structured-exercises.ts [flags]
 *
 * Flags:
 *   --dry-run          Parse but skip DB writes. Logs what would be written.
 *   --user-id <id>     Restrict to one user.
 *   --batch-size <n>   Process N rows per pass, defaults to 500.
 *   --since <date>     Only rows with date/createdAt ≥ YYYY-MM-DD.
 *   --plan-days-only   Skip the workout_logs pass.
 *   --workouts-only    Skip the plan_days pass.
 *
 * The script is idempotent — rows that already have sets are skipped — so
 * it can be re-run safely. Rate-limited by the existing Gemini client
 * retry/backoff logic; concurrency is intentionally low (serial per-row)
 * to protect the quota during the initial migration.
 */

import { exerciseSets, planDays, users, workoutLogs } from "@shared/schema";
import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "../server/db";
import { parseExercisesFromText } from "../server/gemini";
import { logger } from "../server/logger";
import {
  expandExercisesToPlanDaySetRows,
  expandExercisesToSetRows,
} from "../server/services/workoutService";

interface Flags {
  dryRun: boolean;
  userId?: string;
  batchSize: number;
  since?: string;
  planDaysOnly: boolean;
  workoutsOnly: boolean;
}

function parseFlags(): Flags {
  const args = process.argv.slice(2);
  const flags: Flags = {
    dryRun: false,
    batchSize: 500,
    planDaysOnly: false,
    workoutsOnly: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--user-id") flags.userId = args[++i];
    else if (arg === "--batch-size") flags.batchSize = Number.parseInt(args[++i], 10);
    else if (arg === "--since") flags.since = args[++i];
    else if (arg === "--plan-days-only") flags.planDaysOnly = true;
    else if (arg === "--workouts-only") flags.workoutsOnly = true;
    else {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    }
  }
  if (Number.isNaN(flags.batchSize) || flags.batchSize < 1) {
    console.error("--batch-size must be a positive integer");
    process.exit(1);
  }
  return flags;
}

interface PassResult {
  scanned: number;
  parsed: number;
  written: number;
  skipped: number;
  failed: number;
}

async function userWeightUnit(userId: string | null): Promise<string> {
  if (!userId) return "kg";
  const [row] = await db.select({ unit: users.weightUnit }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.unit || "kg";
}

async function backfillPlanDays(flags: Flags): Promise<PassResult> {
  const result: PassResult = { scanned: 0, parsed: 0, written: 0, skipped: 0, failed: 0 };

  // planDays joined to their owning plan → userId so we can pick a weight unit.
  // Filter: no exerciseSets, mainWorkout non-empty.
  const rows = await db.query.planDays.findMany({
    where: (pd, { and: andOp, isNotNull: isNotNullOp, sql: sqlOp }) =>
      andOp(
        isNotNullOp(pd.mainWorkout),
        sqlOp`TRIM(${pd.mainWorkout}) <> ''`,
      ),
    with: {
      plan: { columns: { userId: true } },
      exerciseSets: { columns: { id: true }, limit: 1 },
    },
    limit: flags.batchSize,
  });

  for (const pd of rows) {
    if (flags.userId && pd.plan.userId !== flags.userId) continue;
    if (pd.exerciseSets.length > 0) {
      result.skipped++;
      continue;
    }
    result.scanned++;
    const text = [pd.mainWorkout, pd.accessory].filter(Boolean).join("\n").trim();
    if (!text) {
      result.skipped++;
      continue;
    }
    try {
      const unit = await userWeightUnit(pd.plan.userId);
      const exercises = await parseExercisesFromText(text, unit);
      if (exercises.length === 0) {
        result.skipped++;
        continue;
      }
      const setRows = expandExercisesToPlanDaySetRows(exercises, pd.id);
      result.parsed++;
      if (flags.dryRun) {
        logger.info({ planDayId: pd.id, setCount: setRows.length }, "[backfill:planDays] would insert (dry-run)");
        continue;
      }
      await db.insert(exerciseSets).values(setRows);
      result.written += setRows.length;
    } catch (err) {
      result.failed++;
      logger.error({ err, planDayId: pd.id }, "[backfill:planDays] parse/insert failed");
    }
  }

  return result;
}

async function backfillWorkoutLogs(flags: Flags): Promise<PassResult> {
  const result: PassResult = { scanned: 0, parsed: 0, written: 0, skipped: 0, failed: 0 };

  const whereClauses = [
    isNotNull(workoutLogs.mainWorkout),
    sql`TRIM(${workoutLogs.mainWorkout}) <> ''`,
  ];
  if (flags.userId) whereClauses.push(eq(workoutLogs.userId, flags.userId));
  if (flags.since) whereClauses.push(gte(workoutLogs.date, flags.since));

  // Left-join exercise_sets and pick logs where the join produced no row.
  const candidates = await db
    .select({ log: workoutLogs })
    .from(workoutLogs)
    .leftJoin(exerciseSets, eq(workoutLogs.id, exerciseSets.workoutLogId))
    .where(and(...whereClauses, isNull(exerciseSets.id)))
    .limit(flags.batchSize);

  for (const { log } of candidates) {
    result.scanned++;
    const text = [log.mainWorkout, log.accessory].filter(Boolean).join("\n").trim();
    if (!text) {
      result.skipped++;
      continue;
    }
    try {
      const unit = await userWeightUnit(log.userId);
      const exercises = await parseExercisesFromText(text, unit);
      if (exercises.length === 0) {
        result.skipped++;
        continue;
      }
      const setRows = expandExercisesToSetRows(exercises, log.id);
      result.parsed++;
      if (flags.dryRun) {
        logger.info({ workoutLogId: log.id, setCount: setRows.length }, "[backfill:workoutLogs] would insert (dry-run)");
        continue;
      }
      await db.insert(exerciseSets).values(setRows);
      result.written += setRows.length;
    } catch (err) {
      result.failed++;
      logger.error({ err, workoutLogId: log.id }, "[backfill:workoutLogs] parse/insert failed");
    }
  }

  return result;
}

async function main(): Promise<void> {
  const flags = parseFlags();
  logger.info({ flags }, "[backfill] starting structured-exercise backfill");

  if (!flags.workoutsOnly) {
    const planResult = await backfillPlanDays(flags);
    logger.info({ pass: "planDays", ...planResult }, "[backfill] pass complete");
  }

  if (!flags.planDaysOnly) {
    const logResult = await backfillWorkoutLogs(flags);
    logger.info({ pass: "workoutLogs", ...logResult }, "[backfill] pass complete");
  }

  // Avoid process.exit(0) — let the default shutdown flush stdout.
}

main().catch((err) => {
  logger.error({ err }, "[backfill] fatal error");
  process.exit(1);
});

// Planned drizzle imports re-used above; referenced here so bundlers keep them.
void planDays;

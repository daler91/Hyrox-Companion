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
 * resulting sets are inserted. Every row is processed independently so a
 * single parse failure doesn't block the rest of the run.
 *
 * Usage:
 *   pnpm tsx script/backfill-structured-exercises.ts [flags]
 *
 * Flags:
 *   --dry-run          Parse but skip DB writes. Logs what would be written.
 *   --user-id <id>     Restrict to one user.
 *   --batch-size <n>   Process N rows per pass, defaults to 500.
 *   --since <date>     Only rows with date ≥ YYYY-MM-DD (workout_logs only).
 *   --plan-days-only   Skip the workout_logs pass.
 *   --workouts-only    Skip the plan_days pass.
 *
 * The script is idempotent — rows that already have sets are skipped — so
 * it can be re-run safely. Rate-limited by the existing Gemini client
 * retry/backoff logic; serial per-row to protect the quota during the
 * initial migration.
 */

import {
  exerciseSets,
  type InsertExerciseSet,
  users,
  workoutLogs,
} from "@shared/schema";
import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "../server/db";
import { parseExercisesFromText } from "../server/gemini";
import { logger } from "../server/logger";
import {
  expandExercisesToPlanDaySetRows,
  expandExercisesToSetRows,
} from "../server/services/workoutService";

const DEFAULT_WEIGHT_UNIT = "kg";

interface Flags {
  dryRun: boolean;
  userId?: string;
  batchSize: number;
  since?: string;
  planDaysOnly: boolean;
  workoutsOnly: boolean;
}

interface PassResult {
  scanned: number;
  parsed: number;
  written: number;
  skipped: number;
  failed: number;
}

function emptyResult(): PassResult {
  return { scanned: 0, parsed: 0, written: 0, skipped: 0, failed: 0 };
}

function parseFlagValue(args: string[], index: number, name: string): string {
  const value = args[index];
  if (!value) {
    console.error(`Missing value for ${name}`);
    process.exit(1);
  }
  return value;
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
    switch (arg) {
      case "--dry-run":
        flags.dryRun = true;
        break;
      case "--user-id":
        flags.userId = parseFlagValue(args, ++i, arg);
        break;
      case "--batch-size":
        flags.batchSize = Number.parseInt(parseFlagValue(args, ++i, arg), 10);
        break;
      case "--since":
        flags.since = parseFlagValue(args, ++i, arg);
        break;
      case "--plan-days-only":
        flags.planDaysOnly = true;
        break;
      case "--workouts-only":
        flags.workoutsOnly = true;
        break;
      default:
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

async function userWeightUnit(userId: string | null | undefined): Promise<string> {
  if (!userId) return DEFAULT_WEIGHT_UNIT;
  const [row] = await db.select({ unit: users.weightUnit }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.unit || DEFAULT_WEIGHT_UNIT;
}

/**
 * Describes a free-text row that needs structured sets. The adapter keeps
 * both backfill passes using the same execution loop, which avoids a pair
 * of near-duplicate functions and lets Sonar's cognitive-complexity budget
 * stay comfortably under its ceiling.
 */
interface BackfillCandidate {
  label: string;             // log tag — "planDays" | "workoutLogs"
  ownerId: string;           // planDayId or workoutLogId
  logKey: string;            // "planDayId" | "workoutLogId" for log context
  userId: string | null;
  mainWorkout: string | null;
  accessory: string | null;
  expand: (exercises: Awaited<ReturnType<typeof parseExercisesFromText>>) => InsertExerciseSet[];
}

async function processCandidate(
  cand: BackfillCandidate,
  flags: Flags,
  result: PassResult,
): Promise<void> {
  const text = [cand.mainWorkout, cand.accessory].filter(Boolean).join("\n").trim();
  if (!text) {
    result.skipped++;
    return;
  }
  try {
    const unit = await userWeightUnit(cand.userId);
    const exercises = await parseExercisesFromText(text, unit);
    if (exercises.length === 0) {
      result.skipped++;
      return;
    }
    const setRows = cand.expand(exercises);
    result.parsed++;
    if (flags.dryRun) {
      logger.info(
        { [cand.logKey]: cand.ownerId, setCount: setRows.length },
        `[backfill:${cand.label}] would insert (dry-run)`,
      );
      return;
    }
    await db.insert(exerciseSets).values(setRows);
    result.written += setRows.length;
  } catch (err) {
    result.failed++;
    logger.error(
      { err, [cand.logKey]: cand.ownerId },
      `[backfill:${cand.label}] parse/insert failed`,
    );
  }
}

async function runPass(
  label: string,
  loader: () => Promise<BackfillCandidate[]>,
  flags: Flags,
): Promise<PassResult> {
  const result = emptyResult();
  const candidates = await loader();
  for (const cand of candidates) {
    result.scanned++;
    await processCandidate(cand, flags, result);
  }
  logger.info({ pass: label, ...result }, "[backfill] pass complete");
  return result;
}

async function loadPlanDayCandidates(flags: Flags): Promise<BackfillCandidate[]> {
  const rows = await db.query.planDays.findMany({
    where: (pd, { and: andOp, isNotNull: isNotNullOp, sql: sqlOp }) =>
      andOp(isNotNullOp(pd.mainWorkout), sqlOp`TRIM(${pd.mainWorkout}) <> ''`),
    with: {
      plan: { columns: { userId: true } },
      exerciseSets: { columns: { id: true }, limit: 1 },
    },
    limit: flags.batchSize,
  });

  return rows
    .filter((pd) => pd.exerciseSets.length === 0)
    .filter((pd) => !flags.userId || pd.plan.userId === flags.userId)
    .map((pd) => ({
      label: "planDays",
      ownerId: pd.id,
      logKey: "planDayId",
      userId: pd.plan.userId,
      mainWorkout: pd.mainWorkout,
      accessory: pd.accessory,
      expand: (exercises) => expandExercisesToPlanDaySetRows(exercises, pd.id),
    }));
}

async function loadWorkoutLogCandidates(flags: Flags): Promise<BackfillCandidate[]> {
  const whereClauses = [
    isNotNull(workoutLogs.mainWorkout),
    sql`TRIM(${workoutLogs.mainWorkout}) <> ''`,
  ];
  if (flags.userId) whereClauses.push(eq(workoutLogs.userId, flags.userId));
  if (flags.since) whereClauses.push(gte(workoutLogs.date, flags.since));

  const rows = await db
    .select({ log: workoutLogs })
    .from(workoutLogs)
    .leftJoin(exerciseSets, eq(workoutLogs.id, exerciseSets.workoutLogId))
    .where(and(...whereClauses, isNull(exerciseSets.id)))
    .limit(flags.batchSize);

  return rows.map(({ log }) => ({
    label: "workoutLogs",
    ownerId: log.id,
    logKey: "workoutLogId",
    userId: log.userId,
    mainWorkout: log.mainWorkout,
    accessory: log.accessory,
    expand: (exercises) => expandExercisesToSetRows(exercises, log.id),
  }));
}

async function main(): Promise<void> {
  const flags = parseFlags();
  logger.info({ flags }, "[backfill] starting structured-exercise backfill");

  if (!flags.workoutsOnly) {
    await runPass("planDays", () => loadPlanDayCandidates(flags), flags);
  }
  if (!flags.planDaysOnly) {
    await runPass("workoutLogs", () => loadWorkoutLogCandidates(flags), flags);
  }
}

main().catch((err) => {
  logger.error({ err }, "[backfill] fatal error");
  process.exit(1);
});

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
 *   --after-id <id>    Keyset pagination cursor (process IDs greater than this).
 *   --report-file <p>  Write per-pass JSON reports (<name>-planDays/ext, <name>-workoutLogs/ext).
 *
 * The script is idempotent — rows that already have sets are skipped — so
 * it can be re-run safely. Rate-limited by the existing Gemini client
 * retry/backoff logic; serial per-row to protect the quota during the
 * initial migration.
 */

import {
  exerciseSets,
  type InsertExerciseSet,
  planDays,
  structuredExerciseBackfillReviews,
  trainingPlans,
  users,
  workoutLogs,
} from "@shared/schema";
import { and, eq, gt, gte, isNotNull, isNull, sql } from "drizzle-orm";

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
  reportFile?: string;
  afterId?: string;
}

interface PassResult {
  scanned: number;
  parsed: number;
  written: number;
  skipped: number;
  failed: number;
  emptyParse: number;
  alreadyStructured: number;
}

function emptyResult(): PassResult {
  return { scanned: 0, parsed: 0, written: 0, skipped: 0, failed: 0, emptyParse: 0, alreadyStructured: 0 };
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
      case "--report-file":
        flags.reportFile = parseFlagValue(args, ++i, arg);
        break;
      case "--after-id":
        flags.afterId = parseFlagValue(args, ++i, arg);
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
type ParseStatus = "success" | "failed_parse" | "empty_parse" | "already_structured";
interface BackfillReportRow { ownerType: "planDay" | "workoutLog"; ownerId: string; userId: string | null; status: ParseStatus; reason?: string; }

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
  reportRows: BackfillReportRow[],
): Promise<void> {
  const text = [cand.mainWorkout, cand.accessory].filter(Boolean).join("\n").trim();
  if (!text) {
    result.skipped++;
    result.emptyParse++;
    reportRows.push({ ownerType: cand.logKey === "planDayId" ? "planDay" : "workoutLog", ownerId: cand.ownerId, userId: cand.userId, status: "empty_parse", reason: "empty_text" });
    return;
  }
  try {
    const unit = await userWeightUnit(cand.userId);
    const exercises = await parseExercisesFromText(text, unit);
    if (exercises.length === 0) {
      result.skipped++;
      result.emptyParse++;
      reportRows.push({ ownerType: cand.logKey === "planDayId" ? "planDay" : "workoutLog", ownerId: cand.ownerId, userId: cand.userId, status: "empty_parse", reason: "parser_returned_no_exercises" });
      if (!flags.dryRun) {
        await db.insert(structuredExerciseBackfillReviews).values({
          ownerType: cand.logKey === "planDayId" ? "planDay" : "workoutLog",
          ownerId: cand.ownerId,
          userId: cand.userId,
          status: "needs_manual_review",
          reason: "parser_returned_no_exercises",
        }).onConflictDoUpdate({
          target: [structuredExerciseBackfillReviews.ownerType, structuredExerciseBackfillReviews.ownerId],
          set: { status: "needs_manual_review", reason: "parser_returned_no_exercises", lastSeenAt: sql`now()`, updatedAt: sql`now()` },
        });
      }
      return;
    }
    const setRows = cand.expand(exercises);
    result.parsed++;
    if (flags.dryRun) {
      logger.info(
        { [cand.logKey]: cand.ownerId, setCount: setRows.length },
        `[backfill:${cand.label}] would insert (dry-run)`,
      );
      reportRows.push({
        ownerType: cand.logKey === "planDayId" ? "planDay" : "workoutLog",
        ownerId: cand.ownerId,
        userId: cand.userId,
        status: "success",
      });
      return;
    }
    await db.insert(exerciseSets).values(setRows);
    result.written += setRows.length;
    reportRows.push({ ownerType: cand.logKey === "planDayId" ? "planDay" : "workoutLog", ownerId: cand.ownerId, userId: cand.userId, status: "success" });
    await db.delete(structuredExerciseBackfillReviews).where(and(
      eq(structuredExerciseBackfillReviews.ownerType, cand.logKey === "planDayId" ? "planDay" : "workoutLog"),
      eq(structuredExerciseBackfillReviews.ownerId, cand.ownerId),
    ));
  } catch (err) {
    result.failed++;
    reportRows.push({ ownerType: cand.logKey === "planDayId" ? "planDay" : "workoutLog", ownerId: cand.ownerId, userId: cand.userId, status: "failed_parse", reason: err instanceof Error ? err.message : "parse_error" });
    if (!flags.dryRun) {
      await db.insert(structuredExerciseBackfillReviews).values({
        ownerType: cand.logKey === "planDayId" ? "planDay" : "workoutLog",
        ownerId: cand.ownerId,
        userId: cand.userId,
        status: "needs_manual_review",
        reason: err instanceof Error ? err.message.slice(0, 1000) : "parse_error",
      }).onConflictDoUpdate({
        target: [structuredExerciseBackfillReviews.ownerType, structuredExerciseBackfillReviews.ownerId],
        set: { status: "needs_manual_review", reason: err instanceof Error ? err.message.slice(0, 1000) : "parse_error", lastSeenAt: sql`now()`, updatedAt: sql`now()` },
      });
    }
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
  const reportRows: BackfillReportRow[] = [];
  for (const cand of candidates) {
    result.scanned++;
    await processCandidate(cand, flags, result, reportRows);
  }
  if (flags.reportFile) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const parsed = path.parse(flags.reportFile);
    const ext = parsed.ext || ".json";
    const reportPath = path.format({
      dir: parsed.dir,
      name: `${parsed.name || "backfill-report"}-${label}`,
      ext,
    });
    await fs.writeFile(reportPath, JSON.stringify(reportRows, null, 2), "utf8");
  }
  logger.info({ pass: label, ...result }, "[backfill] pass complete");
  return result;
}

async function loadPlanDayCandidates(flags: Flags): Promise<BackfillCandidate[]> {
  // Filters (exerciseSets empty, optional userId) are applied IN the SQL
  // query so the batch limit counts only rows that actually need backfilling.
  // Doing the filtering in JS after `limit()` used to produce empty batches
  // as soon as the first page of plan_days happened to already have sets,
  // and the backfill would stop making progress on large datasets.
  const whereClauses = [
    isNotNull(planDays.mainWorkout),
    sql`TRIM(${planDays.mainWorkout}) <> ''`,
    isNull(exerciseSets.id),
  ];
  if (flags.userId) whereClauses.push(eq(trainingPlans.userId, flags.userId));
  if (flags.afterId) whereClauses.push(gt(planDays.id, flags.afterId));

  const rows = await db
    .select({
      id: planDays.id,
      mainWorkout: planDays.mainWorkout,
      accessory: planDays.accessory,
      userId: trainingPlans.userId,
    })
    .from(planDays)
    .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
    .leftJoin(exerciseSets, eq(exerciseSets.planDayId, planDays.id))
    .where(and(...whereClauses))
    .orderBy(planDays.id)
    .limit(flags.batchSize);

  return rows.map((pd) => ({
    label: "planDays",
    ownerId: pd.id,
    logKey: "planDayId",
    userId: pd.userId,
    mainWorkout: pd.mainWorkout,
    accessory: pd.accessory,
    expand: (exercises) => expandExercisesToPlanDaySetRows(exercises, pd.id),
  }));
}

async function countPlanDayAlreadyStructured(flags: Flags): Promise<number> {
  const whereClauses = [isNotNull(planDays.mainWorkout), sql`TRIM(${planDays.mainWorkout}) <> ''`, isNotNull(exerciseSets.id)];
  if (flags.userId) whereClauses.push(eq(trainingPlans.userId, flags.userId));
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${planDays.id})` })
    .from(planDays)
    .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
    .leftJoin(exerciseSets, eq(exerciseSets.planDayId, planDays.id))
    .where(and(...whereClauses));
  return Number(row?.count ?? 0);
}

async function loadWorkoutLogCandidates(flags: Flags): Promise<BackfillCandidate[]> {
  const whereClauses = [
    isNotNull(workoutLogs.mainWorkout),
    sql`TRIM(${workoutLogs.mainWorkout}) <> ''`,
  ];
  if (flags.userId) whereClauses.push(eq(workoutLogs.userId, flags.userId));
  if (flags.since) whereClauses.push(gte(workoutLogs.date, flags.since));
  if (flags.afterId) whereClauses.push(gt(workoutLogs.id, flags.afterId));

  const rows = await db
    .select({ log: workoutLogs })
    .from(workoutLogs)
    .leftJoin(exerciseSets, eq(workoutLogs.id, exerciseSets.workoutLogId))
    .where(and(...whereClauses, isNull(exerciseSets.id)))
    .orderBy(workoutLogs.id)
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

async function countWorkoutAlreadyStructured(flags: Flags): Promise<number> {
  const whereClauses = [isNotNull(workoutLogs.mainWorkout), sql`TRIM(${workoutLogs.mainWorkout}) <> ''`, isNotNull(exerciseSets.id)];
  if (flags.userId) whereClauses.push(eq(workoutLogs.userId, flags.userId));
  if (flags.since) whereClauses.push(gte(workoutLogs.date, flags.since));
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${workoutLogs.id})` })
    .from(workoutLogs)
    .leftJoin(exerciseSets, eq(workoutLogs.id, exerciseSets.workoutLogId))
    .where(and(...whereClauses));
  return Number(row?.count ?? 0);
}

async function main(): Promise<void> {
  const flags = parseFlags();
  logger.info({ flags }, "[backfill] starting structured-exercise backfill");

  if (!flags.workoutsOnly) {
    const res = await runPass("planDays", () => loadPlanDayCandidates(flags), flags);
    res.alreadyStructured = await countPlanDayAlreadyStructured(flags);
    logger.info({ pass: "planDays", totalCandidates: res.scanned, successfullyParsed: res.parsed, failedOrEmptyParse: res.failed + res.emptyParse, alreadyStructured: res.alreadyStructured }, "[backfill] dry-run counts");
  }
  if (!flags.planDaysOnly) {
    const res = await runPass("workoutLogs", () => loadWorkoutLogCandidates(flags), flags);
    res.alreadyStructured = await countWorkoutAlreadyStructured(flags);
    logger.info({ pass: "workoutLogs", totalCandidates: res.scanned, successfullyParsed: res.parsed, failedOrEmptyParse: res.failed + res.emptyParse, alreadyStructured: res.alreadyStructured }, "[backfill] dry-run counts");
  }
}

try {
  await main();
} catch (err) {
  logger.error({ err }, "[backfill] fatal error");
  process.exit(1);
}

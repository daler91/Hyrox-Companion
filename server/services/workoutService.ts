import {
  customExercises,
  type ExerciseSet,
  exerciseSets,
  type InsertExerciseSet,
  type InsertWorkoutLog,
  type ParsedExercise,
  planDays,
  type StructureBlockInput,
  type StructureBlockScore,
  structureBlockScoreSchema,
  trainingPlans,
  type UpdateWorkoutLog,
  users,
  type WorkoutLog,
  workoutLogs,
  workoutStructureBlocks,
  workoutStructureSteps,
} from "@shared/schema";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import pLimit from "p-limit";

import { db } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logger } from "../logger";
import { DEFAULT_JOB_OPTIONS, queue } from "../queue";
import { storage } from "../storage";
import { prescribedSetToLogRow } from "../storage/shared";
import { incrementStructuredExerciseCounter } from "./structuredExerciseHealth";

// ⚡ Perf: cap concurrent Gemini parse calls per chunk to protect the
// quota & circuit breaker (CODEBASE_REVIEW_2026-04-12.md #12). Prior code
// chunked at 5 but fired all 5 in parallel; p-limit(3) makes the cap
// explicit and decouples it from chunk size.
const GEMINI_PARSE_CONCURRENCY = 3;

// Drizzle transaction type — any method chain valid on `db` is also valid on `tx`.
type WorkoutTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ⚡ Bolt Performance Optimization:
// Combined multiple O(N) array traversals (.filter, .map, .map) into a single loop
// using a Map to avoid redundant array allocations and garbage collection overhead.
export function extractAndDeduplicateCustomExercises(exercises: ParsedExercise[], userId: string) {
  const uniqueCustomExs = new Map<string, { userId: string; name: string; category: string }>();

  for (const ex of exercises) {
    if (ex.exerciseName === "custom" && ex.customLabel) {
      // Intentionally overwriting to match previous behavior (last-wins)
      uniqueCustomExs.set(ex.customLabel, {
        userId,
        name: ex.customLabel,
        category: ex.category || "conditioning",
      });
    }
  }

  return Array.from(uniqueCustomExs.values());
}

// Hard cap on expanded set rows per workout submit. Zod already bounds per-
// exercise numSets and the exercises array, but their product can still reach
// 10k rows. Ten-thousand rows would bloat a single DB write, stall the client,
// and has no legitimate training use (S13).
const MAX_SET_ROWS_PER_WORKOUT = 1000;

// Owner discriminator: an exercise set row lives under either a workoutLog
// (logged) or a planDay (prescribed). Exactly one id is set per row, enforced
// by the exercise_set_single_owner_check DB constraint.
type SetOwner = { workoutLogId: string } | { planDayId: string };

interface ReplaceStructureOptions {
  readonly deriveExerciseSets?: boolean;
}

export function shouldDeriveStructureExerciseSets(explicitSetCount: number): boolean {
  return explicitSetCount <= 0;
}

function structureReplacementOptions(explicitSetCount: number): ReplaceStructureOptions {
  return { deriveExerciseSets: shouldDeriveStructureExerciseSets(explicitSetCount) };
}

function ownerForeignKeys(owner: SetOwner) {
  if ("workoutLogId" in owner) {
    return { workoutLogId: owner.workoutLogId, planDayId: null };
  }
  return { workoutLogId: null, planDayId: owner.planDayId };
}

function ownerColumns(owner: SetOwner): Partial<InsertExerciseSet> {
  return ownerForeignKeys(owner);
}

function exerciseSetOwnerCondition(owner: SetOwner) {
  return "workoutLogId" in owner
    ? eq(exerciseSets.workoutLogId, owner.workoutLogId)
    : eq(exerciseSets.planDayId, owner.planDayId);
}

function structureBlockOwnerCondition(owner: SetOwner) {
  return "workoutLogId" in owner
    ? eq(workoutStructureBlocks.workoutLogId, owner.workoutLogId)
    : eq(workoutStructureBlocks.planDayId, owner.planDayId);
}

// Per-set measurements. An explicit set has its own reps/weight/…; an
// aggregate (numSets fallback) reuses the exercise-level values. Collapsing
// the two "build row" shapes into this single adapter removes the duplicate
// block Sonar flagged.
interface SetMeasurements {
  setNumber: number;
  reps: number | null;
  weight: number | null;
  distance: number | null;
  time: number | null;
  // Planned values mirror the actuals at log creation when supplied by the
  // client (e.g. when a planDay-rooted draft hands the prescription forward).
  // Null when the user is logging an ad-hoc workout with no prior plan.
  plannedReps: number | null;
  plannedWeight: number | null;
  plannedDistance: number | null;
  plannedTime: number | null;
  blockId: string | null;
  stepNumber: number | null;
  intervalMinute: number | null;
  cycleNumber: number | null;
  stepRole: string | null;
  groupId: string | null;
  intensity: Record<string, unknown> | null;
  load: Record<string, unknown> | null;
  repMode: "total" | "per_side" | null;
  tempo: Record<string, unknown> | null;
  standards: Record<string, unknown> | null;
  notes: string | null;
}

function buildExerciseSetRow(
  ex: ParsedExercise,
  measurements: SetMeasurements,
  ownerCols: Partial<InsertExerciseSet>,
  sortOrder: number,
): InsertExerciseSet {
  return {
    ...ownerCols,
    exerciseName: ex.exerciseName,
    customLabel: ex.customLabel || null,
    category: ex.category,
    setNumber: measurements.setNumber,
    reps: measurements.reps,
    weight: measurements.weight,
    distance: measurements.distance,
    time: measurements.time,
    plannedReps: measurements.plannedReps,
    plannedWeight: measurements.plannedWeight,
    plannedDistance: measurements.plannedDistance,
    plannedTime: measurements.plannedTime,
    blockId: measurements.blockId,
    stepNumber: measurements.stepNumber,
    intervalMinute: measurements.intervalMinute,
    cycleNumber: measurements.cycleNumber,
    stepRole: measurements.stepRole,
    groupId: measurements.groupId,
    intensity: measurements.intensity,
    load: measurements.load,
    repMode: measurements.repMode,
    tempo: measurements.tempo,
    standards: measurements.standards,
    confidence: ex.confidence ?? null,
    notes: measurements.notes,
    sortOrder,
  };
}

function measurementsFromExplicit(set: ParsedExercise["sets"][number]): SetMeasurements {
  return {
    setNumber: set.setNumber || 1,
    reps: set.reps ?? null,
    weight: set.weight ?? null,
    distance: set.distance ?? null,
    time: set.time ?? null,
    plannedReps: set.plannedReps ?? null,
    plannedWeight: set.plannedWeight ?? null,
    plannedDistance: set.plannedDistance ?? null,
    plannedTime: set.plannedTime ?? null,
    blockId: set.blockId ?? null,
    stepNumber: set.stepNumber ?? null,
    intervalMinute: set.intervalMinute ?? null,
    cycleNumber: set.cycleNumber ?? null,
    stepRole: set.stepRole ?? null,
    groupId: set.groupId ?? null,
    intensity: set.intensity ?? null,
    load: set.load ?? null,
    repMode: set.repMode ?? null,
    tempo: set.tempo ?? null,
    standards: set.standards ?? null,
    notes: set.notes || null,
  };
}

function measurementsFromAggregate(ex: ParsedExercise, setNumber: number): SetMeasurements {
  return {
    setNumber,
    reps: ex.reps ?? null,
    weight: ex.weight ?? null,
    distance: ex.distance ?? null,
    time: ex.time ?? null,
    plannedReps: ex.plannedReps ?? null,
    plannedWeight: ex.plannedWeight ?? null,
    plannedDistance: ex.plannedDistance ?? null,
    plannedTime: ex.plannedTime ?? null,
    blockId: ex.blockId ?? null,
    stepNumber: ex.stepNumber ?? null,
    intervalMinute: ex.intervalMinute ?? null,
    cycleNumber: ex.cycleNumber ?? null,
    stepRole: ex.stepRole ?? null,
    groupId: ex.groupId ?? null,
    intensity: ex.intensity ?? null,
    load: ex.load ?? null,
    repMode: ex.repMode ?? null,
    tempo: ex.tempo ?? null,
    standards: ex.standards ?? null,
    notes: ex.notes || null,
  };
}

function appendRowsForExercise(
  ex: ParsedExercise,
  ownerCols: Partial<InsertExerciseSet>,
  rows: InsertExerciseSet[],
  startOrder: number,
): number {
  let sortOrder = startOrder;
  if (ex.sets && Array.isArray(ex.sets)) {
    for (const set of ex.sets) {
      rows.push(buildExerciseSetRow(ex, measurementsFromExplicit(set), ownerCols, sortOrder++));
    }
    return sortOrder;
  }
  const numSets = ex.numSets || 1;
  for (let s = 1; s <= numSets; s++) {
    rows.push(buildExerciseSetRow(ex, measurementsFromAggregate(ex, s), ownerCols, sortOrder++));
  }
  return sortOrder;
}

function assertRowCapacity(rowCount: number, context: "workout" | "plan"): void {
  if (rowCount <= MAX_SET_ROWS_PER_WORKOUT) return;
  // Valid Zod payloads can still reach this cap (200 exercises × 50 sets),
  // so surface it as a structured 400 rather than letting the generic
  // handler turn it into a 500.
  const label = context === "plan" ? "Plan day" : "Workout";
  const unit = context === "plan" ? "days" : "workouts";
  throw new AppError(
    ErrorCode.VALIDATION_ERROR,
    `${label} expanded to ${rowCount} set rows (limit ${MAX_SET_ROWS_PER_WORKOUT}). Split into multiple ${unit}.`,
    400,
    { setRows: rowCount, limit: MAX_SET_ROWS_PER_WORKOUT },
  );
}

function expandExercisesToRows(
  exercises: ParsedExercise[],
  owner: SetOwner,
  context: "workout" | "plan",
): InsertExerciseSet[] {
  const rows: InsertExerciseSet[] = [];
  const ownerCols = ownerColumns(owner);
  let sortOrder = 0;
  for (const ex of exercises) {
    sortOrder = appendRowsForExercise(ex, ownerCols, rows, sortOrder);
  }
  assertRowCapacity(rows.length, context);
  return rows;
}

export function expandExercisesToSetRows(
  exercises: ParsedExercise[],
  workoutLogId: string,
): InsertExerciseSet[] {
  return expandExercisesToRows(exercises, { workoutLogId }, "workout");
}

// Prescribed rows for a plan day. Same shape as logged rows but owned by
// planDayId instead of workoutLogId — when the user logs the plan day, these
// rows get copied into a new workoutLog as starter sets.
export function expandExercisesToPlanDaySetRows(
  exercises: ParsedExercise[],
  planDayId: string,
): InsertExerciseSet[] {
  return expandExercisesToRows(exercises, { planDayId }, "plan");
}

export async function prepareParsedWorkout(
  workout: { id: string; mainWorkout?: string | null; accessory?: string | null },
  weightUnit: string,
): Promise<{ exercises: ParsedExercise[]; setRows: InsertExerciseSet[] } | null> {
  const { parseExercisesFromText } = await import("../gemini");

  const textToParse = [workout.mainWorkout, workout.accessory].filter(Boolean).join("\n");
  if (!textToParse.trim()) return null;

  const exercises = await parseExercisesFromText(textToParse.trim(), weightUnit);
  if (exercises.length === 0) return null;

  const setRows = expandExercisesToSetRows(exercises, workout.id);
  return { exercises, setRows };
}

export async function saveParsedWorkout(
  workoutId: string,
  setRows: InsertExerciseSet[],
): Promise<number> {
  return replaceExerciseSetsByOwner({ workoutLogId: workoutId }, setRows);
}

// ⚡ Bolt Performance Optimization:
// Batch replace exercise sets for multiple workouts in a single transaction
// to avoid N+1 query overhead during batch reparsing.
export async function saveParsedWorkoutsBatch(
  workouts: { workoutId: string; setRows: InsertExerciseSet[] }[],
): Promise<{ saved: number; failed: number }> {
  if (workouts.length === 0) return { saved: 0, failed: 0 };

  const workoutIds = workouts.map((w) => w.workoutId);
  let saved = 0;
  let failed = 0;

  // Drop existing sets in one query, then insert per-workout so one invalid
  // row can't roll back every other parsed workout in the chunk.
  await db.delete(exerciseSets).where(inArray(exerciseSets.workoutLogId, workoutIds));

  for (const workout of workouts) {
    try {
      if (workout.setRows.length > 0) {
        await db.insert(exerciseSets).values(workout.setRows);
      }
      saved++;
    } catch (err) {
      failed++;
      logger.error(
        { err, workoutId: workout.workoutId },
        "Failed to persist parsed exercise sets for workout during batch reparse",
      );
    }
  }

  return { saved, failed };
}

// Replace-all semantics for an owner (either a logged workout or a plan day):
// drop the existing rows inside a single tx and insert the new ones, so repeat
// Parse calls don't accumulate duplicates. Shared by every reparse path.
async function replaceExerciseSetsByOwner(
  owner: SetOwner,
  setRows: InsertExerciseSet[],
): Promise<number> {
  await db.transaction(async (tx) => {
    await tx.delete(exerciseSets).where(exerciseSetOwnerCondition(owner));
    if (setRows.length > 0) {
      await tx.insert(exerciseSets).values(setRows);
    }
  });
  return setRows.length;
}

async function replaceExerciseSetsAndStructureByOwner(
  owner: SetOwner,
  setRows: InsertExerciseSet[],
  structureBlocks?: StructureBlockInput[],
): Promise<number> {
  let structureSetCount = 0;
  await db.transaction(async (tx) => {
    await tx.delete(exerciseSets).where(exerciseSetOwnerCondition(owner));
    await tx.delete(workoutStructureBlocks).where(structureBlockOwnerCondition(owner));
    if (setRows.length > 0) {
      await tx.insert(exerciseSets).values(setRows);
    }
    if (structureBlocks !== undefined) {
      structureSetCount = await replaceStructureForOwner(tx, owner, structureBlocks, structureReplacementOptions(setRows.length));
    }
  });
  return setRows.length + structureSetCount;
}

type ReparseTarget = { id: string; mainWorkout?: string | null; accessory?: string | null };
type CounterSource = "manual" | "voice" | "photo" | "import";
type ReparseWriteThroughResult = { exercises: ParsedExercise[]; setCount: number; saved: true; rejectedCount: number; rejectionReasons: string[]; fallbackUsed: boolean };

const hydrationLocks = new Map<string, Promise<ReparseWriteThroughResult | null>>();

function buildHydrationLockKey(owner: SetOwner): string {
  return "workoutLogId" in owner ? `workout:${owner.workoutLogId}` : `planDay:${owner.planDayId}`;
}

function resolveHydrationQualityState(
  acceptedRowCount: number,
  rejectedRowCount: number,
): "ok" | "degraded" | "failed" {
  if (acceptedRowCount === 0) return "failed";
  if (rejectedRowCount > acceptedRowCount) return "degraded";
  return "ok";
}

async function resolveCounterSource(owner: SetOwner, fallback: CounterSource = "manual"): Promise<CounterSource> {
  if ("planDayId" in owner) return fallback;

  const [row] = await db
    .select({ source: workoutLogs.source })
    .from(workoutLogs)
    .where(eq(workoutLogs.id, owner.workoutLogId))
    .limit(1);

  const rawSource = String(row?.source ?? fallback);
  if (rawSource === "strava" || rawSource === "garmin" || rawSource === "import") return "import";
  if (rawSource === "voice") return "voice";
  if (rawSource === "photo") return "photo";
  return "manual";
}

export async function autoHydrateExerciseSetsFromTextIfNeeded(
  target: ReparseTarget,
  owner: SetOwner,
  weightUnit: string,
  context: "workout" | "plan",
): Promise<{ exercises: ParsedExercise[]; setCount: number; saved: true; rejectedCount: number; rejectionReasons: string[] } | null> {
  const existingCount = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(exerciseSets)
    .where("workoutLogId" in owner ? eq(exerciseSets.workoutLogId, owner.workoutLogId) : eq(exerciseSets.planDayId, owner.planDayId));
  if ((existingCount[0]?.count ?? 0) > 0) return null;

  const textToParse = [target.mainWorkout, target.accessory].filter(Boolean).join("\n").trim();
  if (!textToParse) return null;

  const lockKey = buildHydrationLockKey(owner);
  const existingLock = hydrationLocks.get(lockKey);
  if (existingLock) return existingLock;

  const lockPromise = (async () => {
    logger.info({ context: "health-metrics", event: "exercise_set_auto_hydration_attempt", lockKey }, "Auto hydration attempt");
    let source: CounterSource = "manual";
    try {
      source = await resolveCounterSource(owner);
    } catch (err) {
      logger.warn({ context: "health-metrics", event: "auto_hydration_source_resolution_failed", lockKey, err }, "Auto hydration source resolution failed; defaulting to manual source");
    }
    void incrementStructuredExerciseCounter("workoutLogId" in owner ? "workout_log" : "plan_day", source, "auto_hydration_attempted")
      .catch((err: unknown) => {
        logger.warn({ context: "health-metrics", event: "auto_hydration_attempt_counter_failed", lockKey, err }, "Auto hydration attempt telemetry increment failed");
      });
    return reparseFromText(target, owner, weightUnit, context, source)
      .then((result) => {
        const acceptedRowCount = result?.exercises.length ?? 0;
        const rejectedRowCount = result?.rejectedCount ?? 0;
        const fallbackUsed = result?.fallbackUsed ?? false;
        const qualityState = resolveHydrationQualityState(acceptedRowCount, rejectedRowCount);

        if (qualityState === "ok") {
          logger.info({ context: "health-metrics", event: "exercise_set_auto_hydration_success", lockKey, setCount: result?.setCount ?? 0, acceptedRowCount, rejectedRowCount, fallbackUsed, qualityState }, "Auto hydration success");
        } else {
          logger.warn({ context: "health-metrics", event: "exercise_set_auto_hydration_success_degraded", lockKey, setCount: result?.setCount ?? 0, acceptedRowCount, rejectedRowCount, fallbackUsed, qualityState }, "Auto hydration completed with degraded parse quality");
        }

        void incrementStructuredExerciseCounter("workoutLogId" in owner ? "workout_log" : "plan_day", source, "auto_hydration_succeeded")
          .catch((err: unknown) => {
            logger.warn({ context: "health-metrics", event: "auto_hydration_success_counter_failed", lockKey, err }, "Auto hydration success telemetry increment failed");
          });
        return result;
      })
      .catch((err: unknown) => {
        logger.error({ context: "health-metrics", event: "exercise_set_auto_hydration_failure", lockKey, err }, "Auto hydration failed");
        void incrementStructuredExerciseCounter("workoutLogId" in owner ? "workout_log" : "plan_day", source, "auto_hydration_failed")
          .catch((counterErr: unknown) => {
            logger.warn({ context: "health-metrics", event: "auto_hydration_failure_counter_failed", lockKey, err: counterErr }, "Auto hydration failure telemetry increment failed");
          });
        throw err;
      });
  })().finally(() => hydrationLocks.delete(lockKey));
  hydrationLocks.set(lockKey, lockPromise);
  return lockPromise;
}

// Parse the target's free text with Gemini and REPLACE its structured
// exerciseSets. Returns null when the combined text is empty or produced
// zero exercises. The replace semantics match every reparse call site so a
// repeated Parse press never doubles up rows.
async function reparseFromText(
  target: ReparseTarget,
  owner: SetOwner,
  weightUnit: string,
  context: "workout" | "plan",
  source: CounterSource = "manual",
): Promise<ReparseWriteThroughResult | null> {
  const { parseWorkoutStructureFromTextWithDiagnostics } = await import("../gemini");
  const textToParse = [target.mainWorkout, target.accessory].filter(Boolean).join("\n");
  if (!textToParse.trim()) return null;

  const { acceptedRows, rejectedRows, fallbackUsed, structureBlocks } =
    await parseWorkoutStructureFromTextWithDiagnostics(textToParse.trim(), weightUnit);
  if (acceptedRows.length === 0 && structureBlocks.length === 0) return null;

  const setRows = acceptedRows.length > 0 ? expandExercisesToRows(acceptedRows, owner, context) : [];
  const setCount = await replaceExerciseSetsAndStructureByOwner(
    owner,
    setRows,
    structureBlocks.length > 0 ? structureBlocks : undefined,
  );
  void incrementStructuredExerciseCounter("workoutLogId" in owner ? "workout_log" : "plan_day", source, "manual_fix_completed").catch((err: unknown) => {
    logger.warn({ context: "health-metrics", event: "manual_fix_counter_failed", owner, err }, "Manual fix telemetry increment failed");
  });
  return buildReparseWriteThroughResult(acceptedRows, setCount, rejectedRows.length, fallbackUsed);
}

function buildReparseWriteThroughResult(
  acceptedRows: ParsedExercise[],
  setCount: number,
  rejectedCount: number,
  fallbackUsed: boolean,
): ReparseWriteThroughResult {
  return {
    exercises: acceptedRows,
    setCount,
    saved: true,
    rejectedCount,
    rejectionReasons: rejectedCount > 0 ? ["schema_validation_failed"] : [],
    fallbackUsed,
  };
}

export function reparseWorkout(
  workout: { id: string; mainWorkout?: string | null; accessory?: string | null },
  weightUnit: string,
): Promise<{ exercises: ParsedExercise[]; setCount: number; saved: true; rejectedCount: number; rejectionReasons: string[] } | null> {
  return reparseFromText(workout, { workoutLogId: workout.id }, weightUnit, "workout", "manual");
}

/**
 * Plan-day equivalent of reparseWorkout: parse the plan day's mainWorkout +
 * accessory free text via Gemini and REPLACE the day's prescribed
 * exerciseSets with the structured rows. Used by the Parse button in the
 * workout detail dialog on planned entries so the athlete can type a
 * workout description and get a structured, editable prescription back.
 *
 * Returns null when the combined free text is empty or Gemini produces
 * zero exercises. The replace semantics match the workout-log path so
 * repeated Parse presses don't accumulate duplicate rows.
 */
export function reparsePlanDay(
  planDay: { id: string; mainWorkout?: string | null; accessory?: string | null },
  weightUnit: string,
): Promise<{ exercises: ParsedExercise[]; setCount: number; saved: true; rejectedCount: number; rejectionReasons: string[] } | null> {
  return reparseFromText(planDay, { planDayId: planDay.id }, weightUnit, "plan", "manual");
}

export interface ReparseFromImageInput {
  readonly imageBase64: string;
  readonly mimeType: string;
}

/** Shared image-reparse pipeline for workouts and plan days. */
async function reparseFromImage(
  owner: SetOwner,
  image: ReparseFromImageInput,
  weightUnit: string,
  userId: string,
  context: "workout" | "plan",
  customExerciseNames?: string[],
  source: CounterSource = "photo",
): Promise<ReparseWriteThroughResult | null> {
  const { parseWorkoutStructureFromImageWithDiagnostics } = await import("../gemini");
  const { acceptedRows, rejectedRows, structureBlocks } = await parseWorkoutStructureFromImageWithDiagnostics({
    imageBase64: image.imageBase64,
    mimeType: image.mimeType,
    weightUnit,
    customExerciseNames,
    userId,
  });
  if (acceptedRows.length === 0 && structureBlocks.length === 0) return null;

  const setRows = acceptedRows.length > 0 ? expandExercisesToRows(acceptedRows, owner, context) : [];
  const setCount = await replaceExerciseSetsAndStructureByOwner(
    owner,
    setRows,
    structureBlocks.length > 0 ? structureBlocks : undefined,
  );
  void incrementStructuredExerciseCounter("workoutLogId" in owner ? "workout_log" : "plan_day", source, "manual_fix_completed").catch((err: unknown) => {
    logger.warn({ context: "health-metrics", event: "manual_fix_counter_failed", owner, err }, "Manual fix telemetry increment failed");
  });
  return buildReparseWriteThroughResult(acceptedRows, setCount, rejectedRows.length, false);
}

/**
 * Image equivalent of reparseWorkout — snap a photo of a handwritten /
 * printed plan, run it through Gemini vision, and REPLACE the logged
 * workout's structured exerciseSets with the parsed rows. Mirrors the
 * text path's replace semantics and save transaction so the downstream
 * set-membership behaviour is identical regardless of input modality.
 */
export function reparseWorkoutFromImage(
  workout: { id: string },
  image: ReparseFromImageInput,
  weightUnit: string,
  userId: string,
  customExerciseNames?: string[],
): Promise<{ exercises: ParsedExercise[]; setCount: number; saved: true; rejectedCount: number; rejectionReasons: string[] } | null> {
  return reparseFromImage(
    { workoutLogId: workout.id },
    image,
    weightUnit,
    userId,
    "workout",
    customExerciseNames,
    "photo",
  );
}

export function reparsePlanDayFromImage(
  planDay: { id: string },
  image: ReparseFromImageInput,
  weightUnit: string,
  userId: string,
  customExerciseNames?: string[],
): Promise<{ exercises: ParsedExercise[]; setCount: number; saved: true; rejectedCount: number; rejectionReasons: string[] } | null> {
  return reparseFromImage(
    { planDayId: planDay.id },
    image,
    weightUnit,
    userId,
    "plan",
    customExerciseNames,
    "photo",
  );
}

export type CreateWorkoutResult = WorkoutLog & { exerciseSets?: ExerciseSet[] };
export type UpdateWorkoutResult = WorkoutLog & { exerciseSets?: ExerciseSet[] };

async function resolveActivePlanLinks(
  workoutData: InsertWorkoutLog,
  userId: string,
): Promise<{ planId?: string | null; planDayId?: string | null }> {
  if (workoutData.planDayId) {
    // Already linked to a plan day — derive planId from it
    const planDay = await storage.plans.getPlanDay(workoutData.planDayId, userId);
    if (!planDay) {
      // planDayId does not belong to this user — reject it
      return { planId: null, planDayId: null };
    }
    return { planId: planDay.planId, planDayId: workoutData.planDayId };
  }

  // Standalone workout — find the plan covering the workout's date
  if (!workoutData.date) return {};

  const plan = await storage.plans.getPlanForDate(userId, workoutData.date);
  if (!plan) return {};

  const planId = plan.id;

  // Try to auto-match to a specific plan day on the same date
  const matchingDay = await storage.plans.findMatchingPlanDay(planId, workoutData.date);
  if (matchingDay) {
    return { planId, planDayId: matchingDay.id };
  }

  return { planId };
}

// Insert a workout (+ optional exercise sets + plan-day completion + custom exercises)
// inside a caller-provided transaction. All writes are atomic with the caller's tx.
async function markPlanDayCompleted(
  tx: WorkoutTx,
  planDayId: string,
  userId: string,
): Promise<void> {
  await tx
    .update(planDays)
    .set({ status: "completed" })
    .from(trainingPlans)
    .where(
      and(
        eq(planDays.id, planDayId),
        eq(planDays.planId, trainingPlans.id),
        eq(trainingPlans.userId, userId),
      ),
    );
}

async function insertClientSuppliedExercises(
  tx: WorkoutTx,
  exercises: ParsedExercise[],
  workoutLogId: string,
  userId: string,
): Promise<ExerciseSet[]> {
  const rows = expandExercisesToSetRows(exercises, workoutLogId);
  const savedSets = await tx.insert(exerciseSets).values(rows).returning();

  const uniqueCustomExs = extractAndDeduplicateCustomExercises(exercises, userId);
  if (uniqueCustomExs.length > 0) {
    await tx.insert(customExercises).values(uniqueCustomExs).onConflictDoNothing();
  }
  return savedSets;
}

function synthesizeDefaultStructureBlocks(exercises: ParsedExercise[]): StructureBlockInput[] {
  if (exercises.length === 0) return [];
  const steps = exercises.map((ex, i) => ({
    stepNumber: i + 1,
    exerciseName: ex.exerciseName,
    category: ex.category,
    customLabel: ex.customLabel ?? null,
    stepType: "work" as const,
    stepRole: ex.stepRole ?? "steady",
    groupId: ex.groupId ?? null,
    groupMeta: null,
    targets: null,
  }));
  return [{ sectionType: "main", formatType: "steady", sortOrder: 0, steps }];
}

function resolveStructureBlocksForPersist(args: {
  structureBlocks: StructureBlockInput[] | undefined;
  exercises: ParsedExercise[] | undefined;
  workoutSource: string | null | undefined;
  workoutLogId: string;
}): { blocks: StructureBlockInput[] | undefined; source: "structure_editor" | "legacy_synthesized" | "none" } {
  if (Array.isArray(args.structureBlocks)) {
    return { blocks: args.structureBlocks, source: "structure_editor" };
  }
  if (args.exercises && args.exercises.length > 0) {
    logger.warn({
      context: "workout-structure",
      event: "legacy_structure_synthesis_used",
      workoutLogId: args.workoutLogId,
      workoutSource: args.workoutSource ?? "manual",
      source: "legacy_synthesized",
    }, "Structure editor payload missing; synthesizing structure blocks from legacy exercise rows.");
    return { blocks: synthesizeDefaultStructureBlocks(args.exercises), source: "legacy_synthesized" };
  }
  return { blocks: undefined, source: "none" };
}

function numericTarget(targets: StructureBlockInput["steps"][number]["targets"], ...keys: string[]): number | null {
  if (!targets || typeof targets !== "object") return null;
  for (const key of keys) {
    const value = (targets as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function stringTarget(targets: StructureBlockInput["steps"][number]["targets"], key: string): string | null {
  if (!targets || typeof targets !== "object") return null;
  const value = (targets as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function resolveStructureStepTimeTarget(targets: StructureBlockInput["steps"][number]["targets"]): number | null {
  return numericTarget(targets, "targetTime", "time", "durationSeconds");
}

function isWorkStep(step: StructureBlockInput["steps"][number]): boolean {
  const type = (step.stepType ?? step.stepRole ?? "work").toLowerCase();
  return type !== "rest" && !!step.exerciseName?.trim();
}

function derivedSetRowFromStep(
  owner: SetOwner,
  blockId: string,
  block: StructureBlockInput,
  step: StructureBlockInput["steps"][number],
  sortOrder: number,
): InsertExerciseSet | null {
  if (!isWorkStep(step)) return null;
  const targets = step.targets;
  const reps = numericTarget(targets, "targetReps", "reps");
  const time = resolveStructureStepTimeTarget(targets);
  const distance = numericTarget(targets, "targetDistance", "distance");
  const weight = numericTarget(targets, "targetWeight", "weight");
  return {
    ...ownerColumns(owner),
    exerciseName: step.exerciseName!.trim(),
    customLabel: step.customLabel ?? null,
    category: step.category ?? "conditioning",
    setNumber: 1,
    reps,
    weight,
    distance,
    time,
    blockId,
    stepNumber: step.stepNumber,
    intervalMinute: step.minuteIndex ?? null,
    stepRole: step.stepRole ?? step.stepType ?? "work",
    groupId: step.groupId ?? null,
    intensity: step.intensity ?? null,
    repMode: null,
    tempo: step.tempo ?? null,
    standards: null,
    notes: stringTarget(targets, "instructions") ?? block.instructions ?? null,
    sortOrder,
  };
}

async function nextSortOrderForOwner(tx: WorkoutTx, owner: SetOwner): Promise<number> {
  const [max] = await tx
    .select({ maxOrder: sql<number | null>`max(${exerciseSets.sortOrder})` })
    .from(exerciseSets)
    .where(exerciseSetOwnerCondition(owner));
  return (max?.maxOrder ?? -1) + 1;
}

async function deleteBlockDerivedExerciseSets(tx: WorkoutTx, owner: SetOwner): Promise<void> {
  await tx
    .delete(exerciseSets)
    .where(and(exerciseSetOwnerCondition(owner), isNotNull(exerciseSets.blockId)));
}

async function ownerHasExerciseSets(tx: WorkoutTx, owner: SetOwner): Promise<boolean> {
  const [row] = await tx
    .select({ id: exerciseSets.id })
    .from(exerciseSets)
    .where(exerciseSetOwnerCondition(owner))
    .limit(1);
  return !!row;
}

function structureStepKey(blockId: string | null, stepNumber: number | null): string | null {
  if (!blockId || stepNumber == null) return null;
  return `${blockId}:${stepNumber}`;
}

async function linkedExerciseRowsByStep(tx: WorkoutTx, owner: SetOwner) {
  const rows = await tx
    .select()
    .from(exerciseSets)
    .where(and(exerciseSetOwnerCondition(owner), isNotNull(exerciseSets.blockId)))
    .orderBy(asc(exerciseSets.sortOrder));
  const byStep = new Map<string, ExerciseSet>();
  for (const row of rows) {
    const key = structureStepKey(row.blockId, row.stepNumber);
    if (key && !byStep.has(key)) byStep.set(key, row);
  }
  return byStep;
}

function targetsFromLinkedExerciseSet(row: ExerciseSet): NonNullable<StructureBlockInput["steps"][number]["targets"]> | null {
  const targets: Record<string, unknown> = {};
  const reps = row.plannedReps ?? row.reps;
  const weight = row.plannedWeight ?? row.weight;
  const distance = row.plannedDistance ?? row.distance;
  const time = row.plannedTime ?? row.time;
  if (reps != null) targets.targetReps = reps;
  if (weight != null) targets.targetWeight = weight;
  if (distance != null) targets.targetDistance = distance;
  if (time != null) targets.targetTime = time;
  return Object.keys(targets).length > 0
    ? (targets as NonNullable<StructureBlockInput["steps"][number]["targets"]>)
    : null;
}

async function mirrorStructureStepsFromExerciseRows(
  tx: WorkoutTx,
  owner: SetOwner,
  blocks: StructureBlockInput[],
): Promise<StructureBlockInput[]> {
  const linkedRows = await linkedExerciseRowsByStep(tx, owner);
  if (linkedRows.size === 0) return blocks;
  return blocks.map((block) => ({
    ...block,
    steps: block.steps.map((step) => {
      if ((step.stepType ?? "work") !== "work" || !block.id) return step;
      const linked = linkedRows.get(`${block.id}:${step.stepNumber}`);
      if (!linked) return step;
      return {
        ...step,
        exerciseName: linked.customLabel ?? linked.exerciseName,
        category: linked.category,
        customLabel: linked.customLabel,
        stepRole: step.stepRole ?? linked.stepRole ?? "work",
        groupId: step.groupId ?? linked.groupId,
        targets: step.targets ?? targetsFromLinkedExerciseSet(linked),
      };
    }),
  }));
}

async function clearStaleStructureSetLinks(
  tx: WorkoutTx,
  owner: SetOwner,
  validStepKeys: ReadonlySet<string>,
): Promise<void> {
  const rows = await tx
    .select({ id: exerciseSets.id, blockId: exerciseSets.blockId, stepNumber: exerciseSets.stepNumber })
    .from(exerciseSets)
    .where(and(exerciseSetOwnerCondition(owner), isNotNull(exerciseSets.blockId)));
  for (const row of rows) {
    const key = structureStepKey(row.blockId, row.stepNumber);
    if (key && validStepKeys.has(key)) continue;
    await tx
      .update(exerciseSets)
      .set({
        blockId: null,
        stepNumber: null,
        intervalMinute: null,
        cycleNumber: null,
        stepRole: null,
        groupId: null,
      })
      .where(eq(exerciseSets.id, row.id));
  }
}

function structureBlockInsertValues(owner: SetOwner, block: StructureBlockInput, idx: number) {
  return {
    ...(block.id ? { id: block.id } : {}),
    ...ownerForeignKeys(owner),
    sectionType: block.sectionType,
    formatType: block.formatType,
    durationSeconds: block.durationSeconds ?? null,
    rounds: block.rounds ?? null,
    workSeconds: block.workSeconds ?? null,
    restSeconds: block.restSeconds ?? null,
    durationMinutes: block.durationMinutes ?? null,
    roundCount: block.roundCount ?? null,
    timeCapMinutes: block.timeCapMinutes ?? null,
    workIntervalSec: block.workIntervalSec ?? null,
    restIntervalSec: block.restIntervalSec ?? null,
    score: block.score ?? null,
    sequenceOrder: block.sequenceOrder ?? idx,
    instructions: block.instructions ?? null,
    sortOrder: block.sortOrder ?? idx,
  };
}

function structureStepInsertValues(blockId: string, steps: StructureBlockInput["steps"]) {
  return steps.map((s) => ({
    blockId,
    stepNumber: s.stepNumber,
    minuteIndex: s.minuteIndex ?? null,
    stepType: s.stepType ?? "work",
    exerciseName: s.exerciseName,
    category: s.category,
    customLabel: s.customLabel ?? null,
    stepRole: s.stepRole ?? null,
    targetReps: s.targets?.targetReps ?? s.targets?.reps ?? null,
    targetTime: s.targets?.targetTime ?? s.targets?.time ?? null,
    targetDistance: s.targets?.targetDistance ?? s.targets?.distance ?? null,
    targetWeight: s.targets?.targetWeight ?? s.targets?.weight ?? null,
    groupId: s.groupId ?? null,
    groupMeta: s.groupMeta ?? null,
    intensity: s.intensity ?? null,
    loadMode: s.loadMode ?? null,
    unilateralMode: s.unilateralMode ?? null,
    tempo: s.tempo ?? null,
    constraintTags: s.constraintTags ?? null,
    targets: s.targets ?? null,
  }));
}

async function insertStructureBlock(
  tx: WorkoutTx,
  owner: SetOwner,
  block: StructureBlockInput,
  idx: number,
) {
  const [savedBlock] = await tx.insert(workoutStructureBlocks).values(
    structureBlockInsertValues(owner, block, idx),
  ).returning();
  return savedBlock;
}

function collectDerivedRowsForBlock(args: {
  owner: SetOwner;
  blockId: string;
  block: StructureBlockInput;
  startSortOrder: number;
}): { rows: InsertExerciseSet[]; nextSortOrder: number } {
  const rows: InsertExerciseSet[] = [];
  let sortOrder = args.startSortOrder;
  for (const step of args.block.steps) {
    const row = derivedSetRowFromStep(args.owner, args.blockId, args.block, step, sortOrder);
    if (!row) continue;
    rows.push(row);
    sortOrder += 1;
  }
  return { rows, nextSortOrder: sortOrder };
}

async function replaceStructureForOwner(
  tx: WorkoutTx,
  owner: SetOwner,
  structureBlocks: StructureBlockInput[],
  options: ReplaceStructureOptions = {},
): Promise<number> {
  const deriveExerciseSets = options.deriveExerciseSets ?? !(await ownerHasExerciseSets(tx, owner));
  if (deriveExerciseSets) await deleteBlockDerivedExerciseSets(tx, owner);
  const blocksForPersist = deriveExerciseSets
    ? structureBlocks
    : await mirrorStructureStepsFromExerciseRows(tx, owner, structureBlocks);
  await tx.delete(workoutStructureBlocks).where(structureBlockOwnerCondition(owner));
  if (blocksForPersist.length === 0) {
    if (!deriveExerciseSets) await clearStaleStructureSetLinks(tx, owner, new Set());
    return 0;
  }

  let sortOrder = deriveExerciseSets ? await nextSortOrderForOwner(tx, owner) : 0;
  const derivedRows: InsertExerciseSet[] = [];
  const validStepKeys = new Set<string>();
  for (const [idx, block] of blocksForPersist.entries()) {
    const savedBlock = await insertStructureBlock(tx, owner, block, idx);
    const steps = block.steps ?? [];
    if (steps.length === 0) continue;
    for (const step of steps) {
      validStepKeys.add(`${savedBlock.id}:${step.stepNumber}`);
    }
    await tx.insert(workoutStructureSteps).values(structureStepInsertValues(savedBlock.id, steps));
    if (deriveExerciseSets) {
      const derived = collectDerivedRowsForBlock({ owner, blockId: savedBlock.id, block, startSortOrder: sortOrder });
      derivedRows.push(...derived.rows);
      sortOrder = derived.nextSortOrder;
    }
  }

  if (derivedRows.length > 0) {
    await tx.insert(exerciseSets).values(derivedRows);
  }
  if (!deriveExerciseSets) await clearStaleStructureSetLinks(tx, owner, validStepKeys);
  return derivedRows.length;
}

async function replaceWorkoutStructure(
  tx: WorkoutTx,
  workoutLogId: string,
  structureBlocks: StructureBlockInput[],
  options?: ReplaceStructureOptions,
): Promise<number> {
  return replaceStructureForOwner(tx, { workoutLogId }, structureBlocks, options);
}

/**
 * When a workout is logged against a plan day and the client didn't supply
 * exercises, copy the plan day's prescribed exerciseSets into the new log
 * as starter rows. Inline rather than delegating to
 * storage.workouts.seedExerciseSetsFromPlanDay because that method opens
 * its own transaction and can't nest inside `tx`. Returns an empty array
 * when the plan day has no prescribed rows (e.g., rest days, or a plan
 * generated before structured exercises shipped).
 */
async function copyPrescribedSetsIntoLog(
  tx: WorkoutTx,
  planDayId: string,
  workoutLogId: string,
  blockIdMap: Map<string, string>,
): Promise<ExerciseSet[]> {
  const prescribed = await tx
    .select()
    .from(exerciseSets)
    .where(eq(exerciseSets.planDayId, planDayId))
    .orderBy(asc(exerciseSets.sortOrder));
  if (prescribed.length === 0) return [];

  const copyRows = prescribed.map((p) => {
    const mappedBlockId = p.blockId ? blockIdMap.get(p.blockId) ?? null : null;
    return {
      ...prescribedSetToLogRow(p, workoutLogId),
      blockId: mappedBlockId,
      stepNumber: mappedBlockId ? p.stepNumber : null,
      intervalMinute: mappedBlockId ? p.intervalMinute : null,
      cycleNumber: mappedBlockId ? p.cycleNumber : null,
      stepRole: mappedBlockId ? p.stepRole : null,
      groupId: mappedBlockId ? p.groupId : null,
    };
  });
  return tx.insert(exerciseSets).values(copyRows).returning();
}

async function copyPrescribedStructureIntoLog(
  tx: WorkoutTx,
  planDayId: string,
  workoutLogId: string,
): Promise<Map<string, string>> {
  const blockIdMap = new Map<string, string>();
  const blocks = await tx
    .select()
    .from(workoutStructureBlocks)
    .where(eq(workoutStructureBlocks.planDayId, planDayId))
    .orderBy(asc(workoutStructureBlocks.sortOrder));
  if (blocks.length === 0) return blockIdMap;

  const steps = await tx
    .select()
    .from(workoutStructureSteps)
    .where(inArray(workoutStructureSteps.blockId, blocks.map((b) => b.id)))
    .orderBy(asc(workoutStructureSteps.stepNumber));
  const stepsByBlock = new Map<string, typeof steps>();
  for (const step of steps) {
    const arr = stepsByBlock.get(step.blockId) ?? [];
    arr.push(step);
    stepsByBlock.set(step.blockId, arr);
  }

  for (const block of blocks) {
    const [savedBlock] = await tx.insert(workoutStructureBlocks).values({
      workoutLogId,
      planDayId: null,
      sectionType: block.sectionType,
      formatType: block.formatType,
      durationSeconds: block.durationSeconds,
      rounds: block.rounds,
      workSeconds: block.workSeconds,
      restSeconds: block.restSeconds,
      durationMinutes: block.durationMinutes,
      roundCount: block.roundCount,
      timeCapMinutes: block.timeCapMinutes,
      workIntervalSec: block.workIntervalSec,
      restIntervalSec: block.restIntervalSec,
      score: null,
      sequenceOrder: block.sequenceOrder,
      instructions: block.instructions,
      sortOrder: block.sortOrder,
    }).returning();
    blockIdMap.set(block.id, savedBlock.id);
    const blockSteps = stepsByBlock.get(block.id) ?? [];
    if (blockSteps.length === 0) continue;
    await tx.insert(workoutStructureSteps).values(blockSteps.map((step) => ({
      blockId: savedBlock.id,
      stepNumber: step.stepNumber,
      minuteIndex: step.minuteIndex,
      stepType: step.stepType,
      exerciseName: step.exerciseName,
      category: step.category,
      customLabel: step.customLabel,
      targetReps: step.targetReps,
      targetTime: step.targetTime,
      targetDistance: step.targetDistance,
      targetWeight: step.targetWeight,
      targets: step.targets,
      stepRole: step.stepRole,
      intensity: step.intensity,
      loadMode: step.loadMode,
      unilateralMode: step.unilateralMode,
      tempo: step.tempo,
      constraintTags: step.constraintTags,
      groupId: step.groupId,
      groupMeta: step.groupMeta,
    })));
  }

  return blockIdMap;
}

// ⚡ Bolt Optimization: Consolidate arrays into a single Map to prevent intermediate Set array
// allocations and unnecessary multi-pass iteration loops, improving adherence calculation speed.
export function summarizeSetAdherence(planned: ExerciseSet[], actual: ExerciseSet[]) {
  const counts = new Map<string, { planned: number; actual: number }>();
  const keyFor = (s: ExerciseSet) => (s.customLabel || s.exerciseName || "").toLowerCase().trim();

  for (const s of planned) {
    const key = keyFor(s);
    let entry = counts.get(key);
    if (!entry) {
      entry = { planned: 0, actual: 0 };
      counts.set(key, entry);
    }
    entry.planned++;
  }

  for (const s of actual) {
    const key = keyFor(s);
    let entry = counts.get(key);
    if (!entry) {
      entry = { planned: 0, actual: 0 };
      counts.set(key, entry);
    }
    entry.actual++;
  }

  let matchedSetCount = 0;
  let addedSetCount = 0;
  let removedSetCount = 0;

  for (const { planned, actual } of counts.values()) {
    matchedSetCount += Math.min(planned, actual);
    if (actual > planned) addedSetCount += actual - planned;
    if (planned > actual) removedSetCount += planned - actual;
  }

  return {
    plannedSetCount: planned.length,
    actualSetCount: actual.length,
    matchedSetCount,
    addedSetCount,
    removedSetCount,
    compliancePct: planned.length > 0 ? Math.round((matchedSetCount / planned.length) * 100) : null,
  };
}

export function classifyWorkoutCompliance(compliancePct: number | null): "compliant" | "mostly" | "non_compliant" | "unknown" {
  if (compliancePct == null) return "unknown";
  if (compliancePct >= 85) return "compliant";
  if (compliancePct >= 60) return "mostly";
  return "non_compliant";
}

async function persistAdherenceSnapshot(
  tx: WorkoutTx,
  workoutLogId: string,
  planDayId: string,
  actualSets: ExerciseSet[],
): Promise<void> {
  const plannedSets = await tx
    .select()
    .from(exerciseSets)
    .where(eq(exerciseSets.planDayId, planDayId))
    .orderBy(asc(exerciseSets.sortOrder));

  const snapshot = summarizeSetAdherence(plannedSets, actualSets);
  const classification = classifyWorkoutCompliance(snapshot.compliancePct);
  await tx.update(workoutLogs).set(snapshot).where(eq(workoutLogs.id, workoutLogId));
  logger.info({
    context: "health-metrics",
    event: "workout_compliance_classified",
    workoutLogId,
    planDayId,
    classification,
    compliancePct: snapshot.compliancePct,
    plannedSetCount: snapshot.plannedSetCount,
    actualSetCount: snapshot.actualSetCount,
  }, "Workout compliance classification recorded");
}

async function createWorkoutInTx(
  tx: WorkoutTx,
  enrichedData: InsertWorkoutLog,
  exercises: ParsedExercise[] | undefined,
  structureBlocks: StructureBlockInput[] | undefined,
  userId: string,
): Promise<CreateWorkoutResult> {
  const [log] = await tx
    .insert(workoutLogs)
    .values({
      ...enrichedData,
      userId,
      prescribedMainWorkout: enrichedData.mainWorkout,
      prescribedAccessory: enrichedData.accessory ?? null,
      prescribedNotes: enrichedData.notes ?? null,
    })
    .returning();

  if (enrichedData.planDayId) {
    await markPlanDayCompleted(tx, enrichedData.planDayId, userId);
  }

  let savedSets: ExerciseSet[] = [];
  let clientSuppliedSetCount = 0;
  if (exercises && Array.isArray(exercises) && exercises.length > 0) {
    savedSets = await insertClientSuppliedExercises(tx, exercises, log.id, userId);
    clientSuppliedSetCount = savedSets.length;
  } else if (enrichedData.planDayId) {
    const blockIdMap = await copyPrescribedStructureIntoLog(tx, enrichedData.planDayId, log.id);
    savedSets = await copyPrescribedSetsIntoLog(tx, enrichedData.planDayId, log.id, blockIdMap);
  }

  if (enrichedData.planDayId) {
    await persistAdherenceSnapshot(tx, log.id, enrichedData.planDayId, savedSets);
  }
  const resolvedStructure = resolveStructureBlocksForPersist({
    structureBlocks,
    exercises,
    workoutSource: enrichedData.source,
    workoutLogId: log.id,
  });
  logger.info({
    context: "workout-structure",
    event: "structure_blocks_persist_source",
    workoutLogId: log.id,
    source: resolvedStructure.source,
  }, "Persisting workout structure blocks using resolved source.");
  if (resolvedStructure.blocks !== undefined) {
    await replaceWorkoutStructure(tx, log.id, resolvedStructure.blocks, structureReplacementOptions(clientSuppliedSetCount));
  }

  if (savedSets.length > 0) return { ...log, exerciseSets: savedSets };
  return log;
}

export async function createWorkout(
  workoutData: InsertWorkoutLog,
  exercises: ParsedExercise[] | undefined,
  userId: string,
  structureBlocks?: StructureBlockInput[],
): Promise<CreateWorkoutResult> {
  // Resolve plan linkage before creating the workout
  const planLinks = await resolveActivePlanLinks(workoutData, userId);
  const enrichedData = {
    ...workoutData,
    ...(planLinks.planId !== undefined && { planId: planLinks.planId }),
    ...(planLinks.planDayId !== undefined && { planDayId: planLinks.planDayId }),
  };

  return await db.transaction((tx) => createWorkoutInTx(tx, enrichedData, exercises, structureBlocks, userId));
}

/**
 * Atomically creates a workout and flips the user's isAutoCoaching flag when
 * AI coaching is enabled, then enqueues the auto-coach job post-commit.
 *
 * Rationale (CODEBASE_AUDIT.md §4): previously the workout insert, flag
 * update, and queue enqueue were sequential and non-atomic, so a failure
 * between steps could leave the flag or queue state inconsistent with the
 * workout that had already been committed. Wrapping the DB writes in a
 * single transaction guarantees the flag matches the committed workout.
 * The queue.send stays post-commit (pg-boss has its own transaction, but
 * mixing it with the app tx needs schema changes we're intentionally
 * avoiding here); on enqueue failure we reset the flag as before.
 */
export async function createWorkoutAndScheduleCoaching(
  workoutData: InsertWorkoutLog,
  exercises: ParsedExercise[] | undefined,
  userId: string,
  structureBlocks?: StructureBlockInput[],
): Promise<CreateWorkoutResult> {
  const planLinks = await resolveActivePlanLinks(workoutData, userId);
  const enrichedData = {
    ...workoutData,
    ...(planLinks.planId !== undefined && { planId: planLinks.planId }),
    ...(planLinks.planDayId !== undefined && { planDayId: planLinks.planDayId }),
  };

  const { workout, shouldCoach } = await db.transaction(async (tx) => {
    const created = await createWorkoutInTx(tx, enrichedData, exercises, structureBlocks, userId);

    const [user] = await tx
      .select({ aiCoachEnabled: users.aiCoachEnabled })
      .from(users)
      .where(eq(users.id, userId));

    const should = user?.aiCoachEnabled === true;
    if (should) {
      await tx
        .update(users)
        .set({ isAutoCoaching: true, updatedAt: new Date() })
        .where(eq(users.id, userId));
    }

    return { workout: created, shouldCoach: should };
  });

  if (shouldCoach) {
    // Post-commit enqueue. On failure we reset the flag so the client stops
    // polling for a coaching result that will never arrive.
    // singletonKey + singletonSeconds coalesces rapid-fire workout creation
    // (e.g. bulk CSV import) into a single auto-coach invocation per user
    // within the debounce window (TECHNICAL_DEBT #23).
    queue
      .send(
        "auto-coach",
        { userId },
        { ...DEFAULT_JOB_OPTIONS, singletonKey: `auto-coach:${userId}`, singletonSeconds: 60 },
      )
      .catch((err) => {
        logger.error({ err }, "Failed to queue auto-coach job after workout creation");
        storage.users.updateIsAutoCoaching(userId, false).catch((resetErr) => {
          logger.error({ err: resetErr }, "Failed to reset isAutoCoaching flag after queue error");
        });
      });
  }

  return workout;
}

export async function updateWorkout(
  workoutId: string,
  updateData: UpdateWorkoutLog,
  exercises: ParsedExercise[] | undefined,
  userId: string,
  structureBlocks?: StructureBlockInput[],
): Promise<UpdateWorkoutResult | null> {
  if (exercises && Array.isArray(exercises)) {
    const result = await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(workoutLogs)
        .where(and(eq(workoutLogs.id, workoutId), eq(workoutLogs.userId, userId)));
      if (existing.length === 0) return null;

      const previousDate = existing[0].date;

      const [log] = await tx
        .update(workoutLogs)
        .set(updateData)
        .where(eq(workoutLogs.id, workoutId))
        .returning();

      await tx.delete(exerciseSets).where(eq(exerciseSets.workoutLogId, log.id));

      if (exercises.length > 0) {
        const exerciseSetData = expandExercisesToSetRows(exercises, log.id);
        const savedSets = await tx.insert(exerciseSets).values(exerciseSetData).returning();

        const uniqueCustomExs = extractAndDeduplicateCustomExercises(exercises, userId);

        if (uniqueCustomExs.length > 0) {
          await tx.insert(customExercises).values(uniqueCustomExs).onConflictDoNothing();
        }

        if (structureBlocks !== undefined) {
          await replaceWorkoutStructure(tx, log.id, structureBlocks, structureReplacementOptions(savedSets.length));
        }
        return { log: { ...log, exerciseSets: savedSets } as UpdateWorkoutResult, previousDate };
      }
      if (structureBlocks !== undefined) {
        await replaceWorkoutStructure(tx, log.id, structureBlocks);
      }
      return { log, previousDate };
    });

    if (!result) return null;
    maybeEnqueueAutoCoachOnDateChange(userId, result.previousDate, updateData.date);
    return result.log;
  }

  const previous = await storage.workouts.getWorkoutLog(workoutId, userId);
  if (!previous) return null;
  const result = await db.transaction(async (tx) => {
    const [log] = await tx
      .update(workoutLogs)
      .set(updateData)
      .where(and(eq(workoutLogs.id, workoutId), eq(workoutLogs.userId, userId)))
      .returning();
    if (!log) return null;
    if (structureBlocks !== undefined) {
      await replaceWorkoutStructure(tx, log.id, structureBlocks);
    }
    return log;
  });
  if (!result) return null;
  maybeEnqueueAutoCoachOnDateChange(userId, previous.date, updateData.date);
  return result;
}

export async function replacePlanDayStructure(
  planDayId: string,
  userId: string,
  structureBlocks: StructureBlockInput[],
): Promise<{ exerciseSets: ExerciseSet[]; structureBlocks: StructureBlockInput[] } | null> {
  const planDay = await storage.plans.getPlanDay(planDayId, userId);
  if (!planDay) return null;
  await db.transaction((tx) => replaceStructureForOwner(tx, { planDayId }, structureBlocks));
  const [exerciseSetsForDay, savedStructure] = await Promise.all([
    storage.workouts.getExerciseSetsByPlanDay(planDayId, userId),
    storage.workouts.getWorkoutStructureByPlanDay(planDayId, userId),
  ]);
  return {
    exerciseSets: exerciseSetsForDay ?? [],
    structureBlocks: savedStructure ?? [],
  };
}

async function deriveMissingExerciseSetsFromStructure(
  owner: SetOwner,
  structureBlocks: StructureBlockInput[],
): Promise<number> {
  const existing = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(exerciseSets)
    .where(exerciseSetOwnerCondition(owner));
  if ((existing[0]?.count ?? 0) > 0) return 0;
  if (structureBlocks.length === 0) return 0;
  await db.transaction((tx) => replaceStructureForOwner(tx, owner, structureBlocks, { deriveExerciseSets: true }));
  const after = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(exerciseSets)
    .where(exerciseSetOwnerCondition(owner));
  return after[0]?.count ?? 0;
}

export async function deriveMissingPlanDaySetsFromStructure(
  planDayId: string,
  userId: string,
): Promise<number | null> {
  const planDay = await storage.plans.getPlanDay(planDayId, userId);
  if (!planDay) return null;
  const structureBlocks = await storage.workouts.getWorkoutStructureByPlanDay(planDayId, userId);
  return deriveMissingExerciseSetsFromStructure({ planDayId }, structureBlocks ?? []);
}

export async function deriveMissingWorkoutSetsFromStructure(
  workoutLogId: string,
  userId: string,
): Promise<number | null> {
  const log = await storage.workouts.getWorkoutLog(workoutLogId, userId);
  if (!log) return null;
  const structureBlocks = await storage.workouts.getWorkoutStructureByWorkoutLog(workoutLogId);
  return deriveMissingExerciseSetsFromStructure({ workoutLogId }, structureBlocks);
}

export async function updateWorkoutStructureBlockScore(
  workoutId: string,
  blockId: string,
  userId: string,
  score: StructureBlockScore | null,
): Promise<StructureBlockInput[] | null> {
  const [block] = await db
    .select({ id: workoutStructureBlocks.id, formatType: workoutStructureBlocks.formatType })
    .from(workoutStructureBlocks)
    .innerJoin(workoutLogs, eq(workoutStructureBlocks.workoutLogId, workoutLogs.id))
    .where(and(
      eq(workoutStructureBlocks.id, blockId),
      eq(workoutStructureBlocks.workoutLogId, workoutId),
      eq(workoutLogs.userId, userId),
    ))
    .limit(1);
  if (!block) return null;

  const parsedScore = score === null ? null : structureBlockScoreSchema.parse(score);
  if (parsedScore && parsedScore.type !== block.formatType) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Block score type must match the block format.", 400);
  }

  await db
    .update(workoutStructureBlocks)
    .set({ score: parsedScore })
    .where(eq(workoutStructureBlocks.id, block.id));
  return storage.workouts.getWorkoutStructureByWorkoutLog(workoutId);
}

// When the athlete moves a logged workout to a different day, its position in
// the recent-history window the coach reasons over shifts — rerun the coach so
// upcoming plan-day rationales stay consistent with what was actually done
// and when. Coalesced per-user with the same 60s singleton window used on
// workout create / plan-day reschedule so bursts of edits don't spam Gemini.
function maybeEnqueueAutoCoachOnDateChange(
  userId: string,
  previousDate: string | null | undefined,
  nextDate: string | null | undefined,
): void {
  if (nextDate === undefined) return;
  const prev = previousDate ?? null;
  const next = nextDate ?? null;
  if (prev === next) return;

  queue
    .send(
      "auto-coach",
      { userId },
      { ...DEFAULT_JOB_OPTIONS, singletonKey: `auto-coach:${userId}`, singletonSeconds: 60 },
    )
    .catch((err) =>
      logger.error({ err }, "Failed to queue auto-coach job after workout date change"),
    );
}

export async function processBatchChunk(
  chunk: { id: string; mainWorkout?: string | null; accessory?: string | null }[],
  weightUnit: string,
): Promise<{ parsed: number; failed: number }> {
  let parsed = 0;
  let failed = 0;

  // Parse workouts concurrently in chunks to optimize AI service usage,
  // bounded by p-limit so Gemini never sees more than
  // GEMINI_PARSE_CONCURRENCY in-flight calls regardless of chunk size.
  const limit = pLimit(GEMINI_PARSE_CONCURRENCY);
  const chunkResults = await Promise.allSettled(
    chunk.map((workout) => limit(() => prepareParsedWorkout(workout, weightUnit))),
  );

  const successfulParses: { workoutId: string; setRows: InsertExerciseSet[] }[] = [];

  // Accumulate successfully parsed workouts
  for (let j = 0; j < chunkResults.length; j++) {
    const result = chunkResults[j];
    const workout = chunk[j];

    if (result.status === "rejected") {
      logger.error({ err: result.reason }, `Batch reparse failed for workout ${workout.id}:`);
      failed++;
      continue;
    }

    if (!result.value) {
      failed++;
      continue;
    }

    successfulParses.push({ workoutId: workout.id, setRows: result.value.setRows });
  }

  // ⚡ Bolt Performance Optimization: Replace N+1 queries with a single batch operation
  if (successfulParses.length > 0) {
    const { saved, failed: writeFailures } = await saveParsedWorkoutsBatch(successfulParses);
    parsed += saved;
    failed += writeFailures;
  }

  return { parsed, failed };
}

export async function batchReparseWorkouts(
  userId: string,
): Promise<{ total: number; parsed: number; failed: number }> {
  const workouts = await storage.workouts.getWorkoutsWithoutExerciseSets(userId);
  const user = await storage.users.getUser(userId);
  const weightUnit = user?.weightUnit || "kg";

  let totalParsed = 0;
  let totalFailed = 0;

  // Process workouts concurrently in chunks to improve performance
  // while preventing overload of the Gemini AI service and database
  const CONCURRENCY_LIMIT = 5;
  for (let i = 0; i < workouts.length; i += CONCURRENCY_LIMIT) {
    const chunk = workouts.slice(i, i + CONCURRENCY_LIMIT);
    const { parsed, failed } = await processBatchChunk(chunk, weightUnit);
    totalParsed += parsed;
    totalFailed += failed;
  }

  return { total: workouts.length, parsed: totalParsed, failed: totalFailed };
}

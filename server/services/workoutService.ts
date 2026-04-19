import { customExercises, type ExerciseSet,exerciseSets, type InsertExerciseSet, type InsertWorkoutLog, type ParsedExercise, planDays, trainingPlans, type UpdateWorkoutLog, users, type WorkoutLog, workoutLogs } from "@shared/schema";
import { and,asc, eq } from "drizzle-orm";
import pLimit from "p-limit";

import { db } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logger } from "../logger";
import { DEFAULT_JOB_OPTIONS, queue } from "../queue";
import { storage } from "../storage";

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
  const uniqueCustomExs = new Map<string, { userId: string, name: string, category: string }>();

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

function ownerColumns(owner: SetOwner): Partial<InsertExerciseSet> {
  if ("workoutLogId" in owner) {
    return { workoutLogId: owner.workoutLogId, planDayId: null };
  }
  return { workoutLogId: null, planDayId: owner.planDayId };
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
    confidence: ex.confidence ?? null,
    notes: measurements.notes,
    sortOrder,
  } as InsertExerciseSet;
}

function measurementsFromExplicit(set: ParsedExercise["sets"][number]): SetMeasurements {
  return {
    setNumber: set.setNumber || 1,
    reps: set.reps ?? null,
    weight: set.weight ?? null,
    distance: set.distance ?? null,
    time: set.time ?? null,
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

export function expandExercisesToSetRows(exercises: ParsedExercise[], workoutLogId: string): InsertExerciseSet[] {
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
  weightUnit: string
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
  setRows: InsertExerciseSet[]
): Promise<number> {
  await db.transaction(async (tx) => {
    await tx.delete(exerciseSets).where(eq(exerciseSets.workoutLogId, workoutId));
    if (setRows.length > 0) {
      await tx.insert(exerciseSets).values(setRows);
    }
  });

  return setRows.length;
}

export async function reparseWorkout(
  workout: { id: string; mainWorkout?: string | null; accessory?: string | null },
  weightUnit: string
): Promise<{ exercises: ParsedExercise[]; setCount: number } | null> {
  const prepared = await prepareParsedWorkout(workout, weightUnit);
  if (!prepared) return null;

  const setCount = await saveParsedWorkout(workout.id, prepared.setRows);
  return { exercises: prepared.exercises, setCount };
}

export type CreateWorkoutResult = WorkoutLog & { exerciseSets?: ExerciseSet[] };
export type UpdateWorkoutResult = WorkoutLog & { exerciseSets?: ExerciseSet[] };

async function resolveActivePlanLinks(
  workoutData: InsertWorkoutLog,
  userId: string
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
): Promise<ExerciseSet[]> {
  const prescribed = await tx
    .select()
    .from(exerciseSets)
    .where(eq(exerciseSets.planDayId, planDayId))
    .orderBy(asc(exerciseSets.sortOrder));
  if (prescribed.length === 0) return [];

  const copyRows: InsertExerciseSet[] = prescribed.map((p) => ({
    workoutLogId,
    planDayId: null,
    exerciseName: p.exerciseName,
    customLabel: p.customLabel,
    category: p.category,
    setNumber: p.setNumber,
    reps: p.reps,
    weight: p.weight,
    distance: p.distance,
    time: p.time,
    notes: p.notes,
    confidence: p.confidence,
    sortOrder: p.sortOrder,
  }));
  return tx.insert(exerciseSets).values(copyRows).returning();
}

async function createWorkoutInTx(
  tx: WorkoutTx,
  enrichedData: InsertWorkoutLog,
  exercises: ParsedExercise[] | undefined,
  userId: string
): Promise<CreateWorkoutResult> {
  const [log] = await tx
    .insert(workoutLogs)
    .values({ ...enrichedData, userId })
    .returning();

  if (enrichedData.planDayId) {
    await markPlanDayCompleted(tx, enrichedData.planDayId, userId);
  }

  if (exercises && Array.isArray(exercises) && exercises.length > 0) {
    const savedSets = await insertClientSuppliedExercises(tx, exercises, log.id, userId);
    return { ...log, exerciseSets: savedSets };
  }

  if (enrichedData.planDayId) {
    const savedSets = await copyPrescribedSetsIntoLog(tx, enrichedData.planDayId, log.id);
    if (savedSets.length > 0) return { ...log, exerciseSets: savedSets };
  }

  return log;
}

export async function createWorkout(
  workoutData: InsertWorkoutLog,
  exercises: ParsedExercise[] | undefined,
  userId: string
): Promise<CreateWorkoutResult> {
  // Resolve plan linkage before creating the workout
  const planLinks = await resolveActivePlanLinks(workoutData, userId);
  const enrichedData = {
    ...workoutData,
    ...(planLinks.planId !== undefined && { planId: planLinks.planId }),
    ...(planLinks.planDayId !== undefined && { planDayId: planLinks.planDayId }),
  };

  return await db.transaction((tx) => createWorkoutInTx(tx, enrichedData, exercises, userId));
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
  userId: string
): Promise<CreateWorkoutResult> {
  const planLinks = await resolveActivePlanLinks(workoutData, userId);
  const enrichedData = {
    ...workoutData,
    ...(planLinks.planId !== undefined && { planId: planLinks.planId }),
    ...(planLinks.planDayId !== undefined && { planDayId: planLinks.planDayId }),
  };

  const { workout, shouldCoach } = await db.transaction(async (tx) => {
    const created = await createWorkoutInTx(tx, enrichedData, exercises, userId);

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
  userId: string
): Promise<UpdateWorkoutResult | null> {
  if (exercises && Array.isArray(exercises)) {
    return await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(workoutLogs)
        .where(and(eq(workoutLogs.id, workoutId), eq(workoutLogs.userId, userId)));
      if (existing.length === 0) return null;

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
          await tx
            .insert(customExercises)
            .values(uniqueCustomExs)
            .onConflictDoNothing();
        }

        return { ...log, exerciseSets: savedSets };
      }

      return log;
    });
  }

  const log = await storage.workouts.updateWorkoutLog(workoutId, updateData, userId);
  if (!log) return null;
  return log;
}

export async function processBatchChunk(
  chunk: { id: string; mainWorkout?: string | null; accessory?: string | null }[],
  weightUnit: string
): Promise<{ parsed: number; failed: number }> {
  let parsed = 0;
  let failed = 0;

  // Parse workouts concurrently in chunks to optimize AI service usage,
  // bounded by p-limit so Gemini never sees more than
  // GEMINI_PARSE_CONCURRENCY in-flight calls regardless of chunk size.
  const limit = pLimit(GEMINI_PARSE_CONCURRENCY);
  const chunkResults = await Promise.allSettled(
    chunk.map(workout => limit(() => prepareParsedWorkout(workout, weightUnit)))
  );

  // Save each successfully parsed workout sequentially to prevent DB connection strain
  for (let j = 0; j < chunkResults.length; j++) {
    const result = chunkResults[j];
    const workout = chunk[j];

    if (result.status === 'rejected') {
      logger.error({ err: result.reason }, `Batch reparse failed for workout ${workout.id}:`);
      failed++;
      continue;
    }

    if (!result.value) {
      failed++;
      continue;
    }

    try {
      await saveParsedWorkout(workout.id, result.value.setRows);
      parsed++;
    } catch (dbError) {
      logger.error({ err: dbError }, `Failed to save re-parsed workout ${workout.id}:`);
      failed++;
    }
  }

  return { parsed, failed };
}

export async function batchReparseWorkouts(userId: string): Promise<{ total: number; parsed: number; failed: number }> {
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

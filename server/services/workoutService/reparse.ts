import { exerciseSets, type InsertExerciseSet, type ParsedExercise, workoutLogs } from "@shared/schema";
import type { UnitPreferences } from "@shared/unitConversion";
import { eq, sql } from "drizzle-orm";
import pLimit from "p-limit";

import { db } from "../../db";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { incrementStructuredExerciseCounter } from "../structuredExerciseHealth";
import { replaceExerciseSetsAndStructureByOwner, saveParsedWorkoutsBatch } from "./persistence";
import { expandExercisesToRows, prepareParsedWorkout } from "./setRows";
import type { SetOwner } from "./types";

const AI_PARSE_CONCURRENCY = 3;

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
  unitPreferences: UnitPreferences,
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
    return reparseFromText(target, owner, unitPreferences, context, source)
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

// Parse the target's free text with the configured text provider and REPLACE its structured
// exerciseSets. Returns null when the combined text is empty or produced
// zero exercises. The replace semantics match every reparse call site so a
// repeated Parse press never doubles up rows.
async function reparseFromText(
  target: ReparseTarget,
  owner: SetOwner,
  unitPreferences: UnitPreferences,
  context: "workout" | "plan",
  source: CounterSource = "manual",
): Promise<ReparseWriteThroughResult | null> {
  const { parseWorkoutStructureFromTextWithDiagnostics } = await import("../../gemini");
  const textToParse = [target.mainWorkout, target.accessory].filter(Boolean).join("\n");
  if (!textToParse.trim()) return null;

  const { acceptedRows, rejectedRows, fallbackUsed, structureBlocks } =
    await parseWorkoutStructureFromTextWithDiagnostics(textToParse.trim(), unitPreferences);
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
  unitPreferences: UnitPreferences,
): Promise<{ exercises: ParsedExercise[]; setCount: number; saved: true; rejectedCount: number; rejectionReasons: string[] } | null> {
  return reparseFromText(workout, { workoutLogId: workout.id }, unitPreferences, "workout", "manual");
}

/**
 * Plan-day equivalent of reparseWorkout: parse the plan day's mainWorkout +
 * accessory free text via the configured text provider and REPLACE the day's prescribed
 * exerciseSets with the structured rows. Used by the Parse button in the
 * workout detail dialog on planned entries so the athlete can type a
 * workout description and get a structured, editable prescription back.
 *
 * Returns null when the combined free text is empty or the provider produces
 * zero exercises. The replace semantics match the workout-log path so
 * repeated Parse presses don't accumulate duplicate rows.
 */
export function reparsePlanDay(
  planDay: { id: string; mainWorkout?: string | null; accessory?: string | null },
  unitPreferences: UnitPreferences,
): Promise<{ exercises: ParsedExercise[]; setCount: number; saved: true; rejectedCount: number; rejectionReasons: string[] } | null> {
  return reparseFromText(planDay, { planDayId: planDay.id }, unitPreferences, "plan", "manual");
}

export interface ReparseFromImageInput {
  readonly imageBase64: string;
  readonly mimeType: string;
}

/** Shared image-reparse pipeline for workouts and plan days. */
async function reparseFromImage(
  owner: SetOwner,
  image: ReparseFromImageInput,
  unitPreferences: UnitPreferences,
  userId: string,
  context: "workout" | "plan",
  customExerciseNames?: string[],
  source: CounterSource = "photo",
): Promise<ReparseWriteThroughResult | null> {
  const { parseWorkoutStructureFromImageWithDiagnostics } = await import("../../gemini");
  const { acceptedRows, rejectedRows, structureBlocks } = await parseWorkoutStructureFromImageWithDiagnostics({
    imageBase64: image.imageBase64,
    mimeType: image.mimeType,
    weightUnit: unitPreferences.weightUnit ?? "kg",
    distanceUnit: unitPreferences.distanceUnit ?? "km",
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
  unitPreferences: UnitPreferences,
  userId: string,
  customExerciseNames?: string[],
): Promise<{ exercises: ParsedExercise[]; setCount: number; saved: true; rejectedCount: number; rejectionReasons: string[] } | null> {
  return reparseFromImage(
    { workoutLogId: workout.id },
    image,
    unitPreferences,
    userId,
    "workout",
    customExerciseNames,
    "photo",
  );
}

export function reparsePlanDayFromImage(
  planDay: { id: string },
  image: ReparseFromImageInput,
  unitPreferences: UnitPreferences,
  userId: string,
  customExerciseNames?: string[],
): Promise<{ exercises: ParsedExercise[]; setCount: number; saved: true; rejectedCount: number; rejectionReasons: string[] } | null> {
  return reparseFromImage(
    { planDayId: planDay.id },
    image,
    unitPreferences,
    userId,
    "plan",
    customExerciseNames,
    "photo",
  );
}

export async function processBatchChunk(
  chunk: { id: string; mainWorkout?: string | null; accessory?: string | null }[],
  unitPreferences: UnitPreferences,
): Promise<{ parsed: number; failed: number }> {
  let parsed = 0;
  let failed = 0;

  // Parse workouts concurrently in chunks to optimize AI service usage,
  // bounded by p-limit so the provider never sees more than
  // AI_PARSE_CONCURRENCY in-flight calls regardless of chunk size.
  const limit = pLimit(AI_PARSE_CONCURRENCY);
  const chunkResults = await Promise.allSettled(
    chunk.map((workout) => limit(() => prepareParsedWorkout(workout, unitPreferences))),
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
  const unitPreferences = { weightUnit: user?.weightUnit || "kg", distanceUnit: user?.distanceUnit || "km" };

  let totalParsed = 0;
  let totalFailed = 0;

  // Process workouts concurrently in chunks to improve performance
  // while preventing overload of the AI provider and database
  const CONCURRENCY_LIMIT = 5;
  for (let i = 0; i < workouts.length; i += CONCURRENCY_LIMIT) {
    const chunk = workouts.slice(i, i + CONCURRENCY_LIMIT);
    const { parsed, failed } = await processBatchChunk(chunk, unitPreferences);
    totalParsed += parsed;
    totalFailed += failed;
  }

  return { total: workouts.length, parsed: totalParsed, failed: totalFailed };
}

import { type InsertExerciseSet, type ParsedExercise } from "@shared/schema";
import type { UnitPreferences } from "@shared/unitConversion";

import { AppError, ErrorCode } from "../../errors";
import { ownerColumns } from "./owners";
import type { SetOwner } from "./types";

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

export function expandExercisesToRows(
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
  unitPreferences: UnitPreferences,
): Promise<{ exercises: ParsedExercise[]; setRows: InsertExerciseSet[] } | null> {
  const { parseExercisesFromText } = await import("../../gemini");

  const textToParse = [workout.mainWorkout, workout.accessory].filter(Boolean).join("\n");
  if (!textToParse.trim()) return null;

  const exercises = await parseExercisesFromText(textToParse.trim(), unitPreferences);
  if (exercises.length === 0) return null;

  const setRows = expandExercisesToSetRows(exercises, workout.id);
  return { exercises, setRows };
}

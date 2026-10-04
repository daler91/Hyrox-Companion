import {
  type CoachNoteInputs,
  exerciseSets,
  type InsertExerciseSet,
  type WorkoutSuggestion,
} from "@shared/schema";
import { normalizeWorkoutTextUnits, type UnitPreferences } from "@shared/unitConversion";
import { eq, sql } from "drizzle-orm";

import type { DbExecutor } from "../db";
import { parseExercisesFromText } from "../gemini/index";
import { expandExercisesToPlanDaySetRows } from "./workoutService";

type StructuredSuggestionLike = Pick<WorkoutSuggestion, "workoutId" | "action" | "recommendation">;

/**
 * Whether a suggestion asks a table-backed day for a replace that the table
 * cannot scope. exercise_sets rows carry no main/accessory section, so a
 * structured "replace" can only swap the whole table: right for a mainWorkout
 * replace (the prompt asks for the complete revised prescription), wrong for
 * an accessory-only one, which would delete the main work along with the
 * accessories. Callers refuse these rather than guess which rows are which.
 * AI13 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function isUnscopedStructuredReplace(
  suggestion: Pick<WorkoutSuggestion, "targetField" | "action">,
): boolean {
  return suggestion.action === "replace" && suggestion.targetField === "accessory";
}

/**
 * The day's free text after a structured "replace". The replace swapped the
 * whole table, so the text that described the old rows would contradict the
 * new ones: the recommendation becomes mainWorkout (unit-normalized like a
 * text write) and accessory/notes are cleared. The auto-coach and the manual
 * Apply both reconcile this way. AI13 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function structuredReplaceTextUpdates(
  recommendation: string,
  unitPreferences: UnitPreferences,
): { mainWorkout: string; accessory: null; notes: null } {
  return {
    mainWorkout: normalizeWorkoutTextUnits(recommendation, unitPreferences) ?? recommendation,
    accessory: null,
    notes: null,
  };
}

interface ReplacedDay {
  readonly focus: string;
  readonly mainWorkout: string;
  readonly accessory?: string | null;
  readonly notes?: string | null;
  readonly aiInputsUsed?: CoachNoteInputs | null;
}

/**
 * Keep what a structured "replace" swapped out as the day's "Originally
 * planned" record. Only the first replace records it, so a later one does not
 * record the coach's own earlier version as the original — unless `force`, for
 * a conversion that retitles the day. AI13 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function withReplacedPrescription(
  inputs: CoachNoteInputs,
  day: ReplacedDay,
  force = false,
): CoachNoteInputs {
  if (!force && day.aiInputsUsed?.replacedPrescription) return inputs;
  return {
    ...inputs,
    replacedPrescription: {
      focus: day.focus,
      mainWorkout: day.mainWorkout,
      accessory: day.accessory ?? null,
      notes: day.notes ?? null,
    },
  };
}

export async function parseStructuredPlanDaySuggestionRows(
  suggestion: Pick<StructuredSuggestionLike, "workoutId" | "recommendation">,
  unitPreferences: UnitPreferences,
  userId: string,
): Promise<InsertExerciseSet[]> {
  const parsedExercises = await parseExercisesFromText(
    suggestion.recommendation,
    unitPreferences,
    undefined,
    userId,
  );

  return expandExercisesToPlanDaySetRows(parsedExercises, suggestion.workoutId, unitPreferences);
}

async function getNextPlanDaySortOrder(planDayId: string, tx: DbExecutor): Promise<number> {
  const [row] = await tx
    .select({ maxSortOrder: sql<number>`coalesce(max(${exerciseSets.sortOrder}), -1)` })
    .from(exerciseSets)
    .where(eq(exerciseSets.planDayId, planDayId));

  return Number(row?.maxSortOrder ?? -1) + 1;
}

function applySortOffset(setRows: InsertExerciseSet[], sortOffset: number): InsertExerciseSet[] {
  return setRows.map((row, index) => ({
    ...row,
    sortOrder: sortOffset + index,
  }));
}

export async function applyStructuredPlanDaySuggestionRows(
  planDayId: string,
  action: StructuredSuggestionLike["action"],
  setRows: InsertExerciseSet[],
  tx: DbExecutor,
): Promise<void> {
  if (setRows.length === 0) {
    return;
  }

  const rowsToInsert =
    action === "append"
      ? applySortOffset(setRows, await getNextPlanDaySortOrder(planDayId, tx))
      : setRows;

  if (action === "replace") {
    await tx.delete(exerciseSets).where(eq(exerciseSets.planDayId, planDayId));
  }

  await tx.insert(exerciseSets).values(rowsToInsert);
}

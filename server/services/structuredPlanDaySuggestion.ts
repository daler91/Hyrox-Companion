import { exerciseSets, type InsertExerciseSet, type WorkoutSuggestion } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

import type { DbExecutor } from "../db";
import { parseExercisesFromText } from "../gemini/index";
import { expandExercisesToPlanDaySetRows } from "./workoutService";

type StructuredSuggestionLike = Pick<WorkoutSuggestion, "workoutId" | "action" | "recommendation">;

export async function parseStructuredPlanDaySuggestionRows(
  suggestion: Pick<StructuredSuggestionLike, "workoutId" | "recommendation">,
  weightUnit: string,
  userId: string,
): Promise<InsertExerciseSet[]> {
  const parsedExercises = await parseExercisesFromText(
    suggestion.recommendation,
    weightUnit,
    undefined,
    userId,
  );

  return expandExercisesToPlanDaySetRows(parsedExercises, suggestion.workoutId);
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

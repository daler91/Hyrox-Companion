import { exerciseSets, workoutLogs, type ExerciseSet } from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, gte, lte, type SQL } from "drizzle-orm";

const exerciseSetWithDateFields = {
  id: exerciseSets.id,
  workoutLogId: exerciseSets.workoutLogId,
  exerciseName: exerciseSets.exerciseName,
  customLabel: exerciseSets.customLabel,
  category: exerciseSets.category,
  setNumber: exerciseSets.setNumber,
  reps: exerciseSets.reps,
  weight: exerciseSets.weight,
  distance: exerciseSets.distance,
  time: exerciseSets.time,
  notes: exerciseSets.notes,
  confidence: exerciseSets.confidence,
  sortOrder: exerciseSets.sortOrder,
  date: workoutLogs.date,
};

export async function queryExerciseSetsWithDates(
  userId: string,
  filters?: {
    exerciseName?: string;
    from?: string;
    to?: string;
  },
): Promise<(ExerciseSet & { date: string })[]> {
  const conditions: SQL[] = [eq(workoutLogs.userId, userId)];

  if (filters?.exerciseName) {
    conditions.push(eq(exerciseSets.exerciseName, filters.exerciseName));
  }
  if (filters?.from) {
    conditions.push(gte(workoutLogs.date, filters.from));
  }
  if (filters?.to) {
    conditions.push(lte(workoutLogs.date, filters.to));
  }

  return await db
    .select(exerciseSetWithDateFields)
    .from(exerciseSets)
    .innerJoin(workoutLogs, eq(exerciseSets.workoutLogId, workoutLogs.id))
    .where(and(...conditions))
    .orderBy(desc(workoutLogs.date));
}

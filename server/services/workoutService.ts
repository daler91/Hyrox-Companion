import { storage } from "../storage";
import { db } from "../db";
import { workoutLogs, exerciseSets, planDays, customExercises } from "@shared/schema";
import type { InsertWorkoutLog, UpdateWorkoutLog, InsertExerciseSet, WorkoutLog, ExerciseSet } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export function expandExercisesToSetRows(exercises: any[], workoutLogId: string): InsertExerciseSet[] {
  const rows: InsertExerciseSet[] = [];
  let sortOrder = 0;
  for (const ex of exercises) {
    if (ex.sets && Array.isArray(ex.sets)) {
      for (const set of ex.sets) {
        rows.push({
          workoutLogId,
          exerciseName: ex.exerciseName,
          customLabel: ex.customLabel || null,
          category: ex.category,
          setNumber: set.setNumber || 1,
          reps: set.reps ?? null,
          weight: set.weight ?? null,
          distance: set.distance ?? null,
          time: set.time ?? null,
          confidence: ex.confidence ?? null,
          notes: set.notes || null,
          sortOrder: sortOrder++,
        });
      }
    } else {
      const numSets = ex.numSets || 1;
      for (let s = 1; s <= numSets; s++) {
        rows.push({
          workoutLogId,
          exerciseName: ex.exerciseName,
          customLabel: ex.customLabel || null,
          category: ex.category,
          setNumber: s,
          reps: ex.reps ?? null,
          weight: ex.weight ?? null,
          distance: ex.distance ?? null,
          time: ex.time ?? null,
          notes: ex.notes || null,
          sortOrder: sortOrder++,
        });
      }
    }
  }
  return rows;
}

export async function upsertCustomExercisesFromSets(exercises: any[], userId: string): Promise<void> {
  const seen = new Set<string>();
  const customExs = exercises
    .filter((ex) => {
      if (ex.exerciseName !== "custom" || !ex.customLabel) return false;
      if (seen.has(ex.customLabel)) return false;
      seen.add(ex.customLabel);
      return true;
    })
    .map((ex) => ({
      userId,
      name: ex.customLabel,
      category: ex.category || "conditioning",
    }));

  if (customExs.length > 0) {
    await storage.upsertCustomExercises(customExs);
  }
}

export async function reparseWorkout(
  workout: { id: string; mainWorkout?: string | null; accessory?: string | null },
  weightUnit: string
): Promise<{ exercises: any[]; setCount: number } | null> {
  const { parseExercisesFromText } = await import("../gemini");
  const { exerciseSets } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");

  const textToParse = [workout.mainWorkout, workout.accessory].filter(Boolean).join("\n");
  if (!textToParse.trim()) return null;

  const exercises = await parseExercisesFromText(textToParse.trim(), weightUnit);
  if (exercises.length === 0) return null;

  const setRows = expandExercisesToSetRows(exercises, workout.id);

  await db.transaction(async (tx) => {
    await tx.delete(exerciseSets).where(eq(exerciseSets.workoutLogId, workout.id));
    if (setRows.length > 0) {
      await tx.insert(exerciseSets).values(setRows);
    }
  });

  return { exercises, setCount: setRows.length };
}

export type CreateWorkoutResult = WorkoutLog & { exerciseSets?: ExerciseSet[] };
export type UpdateWorkoutResult = WorkoutLog & { exerciseSets?: ExerciseSet[] };

export async function createWorkout(
  workoutData: InsertWorkoutLog,
  exercises: any[] | undefined,
  userId: string
): Promise<CreateWorkoutResult> {
  if (exercises && Array.isArray(exercises) && exercises.length > 0) {
    return await db.transaction(async (tx) => {
      const [log] = await tx
        .insert(workoutLogs)
        .values({ ...workoutData, userId })
        .returning();

      if (workoutData.planDayId) {
        await tx
          .update(planDays)
          .set({ status: "completed" })
          .where(eq(planDays.id, workoutData.planDayId));
      }

      const exerciseSetData = expandExercisesToSetRows(exercises, log.id);
      const savedSets = await tx.insert(exerciseSets).values(exerciseSetData).returning();

      const seen = new Set<string>();
      const customExs = exercises
        .filter((ex) => {
          if (ex.exerciseName !== "custom" || !ex.customLabel) return false;
          if (seen.has(ex.customLabel)) return false;
          seen.add(ex.customLabel);
          return true;
        })
        .map((ex) => ({
          userId,
          name: ex.customLabel,
          category: ex.category || "conditioning",
        }));

      if (customExs.length > 0) {
        await tx.insert(customExercises).values(customExs).onConflictDoNothing();
      }

      return { ...log, exerciseSets: savedSets };
    });
  }

  return await storage.createWorkoutLog({ ...workoutData, userId });
}

export async function updateWorkout(
  workoutId: string,
  updateData: UpdateWorkoutLog,
  exercises: any[] | undefined,
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

        const seen = new Set<string>();
        const customExs = exercises
          .filter((ex) => {
            if (ex.exerciseName !== "custom" || !ex.customLabel) return false;
            if (seen.has(ex.customLabel)) return false;
            seen.add(ex.customLabel);
            return true;
          })
          .map((ex) => ({
            userId,
            name: ex.customLabel,
            category: ex.category || "conditioning",
          }));

        if (customExs.length > 0) {
          await tx.insert(customExercises).values(customExs).onConflictDoNothing();
        }

        return { ...log, exerciseSets: savedSets };
      }

      return log;
    });
  }

  const log = await storage.updateWorkoutLog(workoutId, updateData, userId);
  if (!log) return null;
  return log;
}

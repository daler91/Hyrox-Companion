import { exerciseSets, type InsertExerciseSet, type StructureBlockInput, workoutStructureBlocks } from "@shared/schema";
import { inArray } from "drizzle-orm";

import { db } from "../../db";
import { logger } from "../../logger";
import { exerciseSetOwnerCondition, structureBlockOwnerCondition } from "./owners";
import { replaceStructureForOwner, structureReplacementOptions } from "./structure";
import type { SetOwner } from "./types";

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

export async function replaceExerciseSetsAndStructureByOwner(
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

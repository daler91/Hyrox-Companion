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

/**
 * Batch replace exercise sets for several workouts at once, so a chunked
 * reparse pays one DELETE and one INSERT rather than two per workout.
 *
 * The delete and the insert MUST share a transaction, which the comment here
 * used to claim and the code did not do. The insert is one multi-row statement
 * across the whole chunk, so a single bad parsed row (a negative weight, a
 * `set_number` of 0 — anything the CHECK constraints reject) fails the insert
 * for every workout in it. With the delete already committed, that left those
 * workouts with no sets at all and returned `failed`, having destroyed rows it
 * could not put back.
 *
 * Reaching it needs the delete to have something to delete. `batchReparse-
 * Workouts` snapshots "workouts with no sets" once, then works through chunks
 * of five with AI parses in between, so minutes can pass between the snapshot
 * and a late chunk's delete — long enough for the athlete to open one of those
 * workouts and log sets by hand. Those are the rows that went missing.
 *
 * `replaceExerciseSetsByOwner` and `replaceExerciseSetsAndStructureByOwner`
 * below already do this correctly; this is the same shape.
 */
export async function saveParsedWorkoutsBatch(
  workouts: { workoutId: string; setRows: InsertExerciseSet[] }[],
): Promise<{ saved: number; failed: number }> {
  if (workouts.length === 0) return { saved: 0, failed: 0 };

  const workoutIds = workouts.map((w) => w.workoutId);

  try {
    await db.transaction(async (tx) => {
      await tx.delete(exerciseSets).where(inArray(exerciseSets.workoutLogId, workoutIds));
      const allSetRows = workouts.flatMap((w) => w.setRows);
      if (allSetRows.length > 0) {
        await tx.insert(exerciseSets).values(allSetRows);
      }
    });
    return { saved: workouts.length, failed: 0 };
  } catch (err) {
    // The transaction rolled back, so the existing sets are still there; the
    // caller counts these workouts as unparsed and they stay eligible for a
    // later reparse.
    logger.error(
      { err, workoutCount: workouts.length },
      "Failed to persist parsed exercise sets during batch reparse; rolled back",
    );
    return { saved: 0, failed: workouts.length };
  }
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

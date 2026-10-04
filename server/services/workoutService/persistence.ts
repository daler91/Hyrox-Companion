import {
  exerciseSets,
  type InsertExerciseSet,
  type StructureBlockInput,
  workoutLogs,
  workoutStructureBlocks,
} from "@shared/schema";
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
 * Batch write parsed exercise sets for several workouts at once, so a chunked
 * reparse pays one INSERT rather than one per workout.
 *
 * Every workout in a chunk came from `getWorkoutsWithoutExerciseSets`, so the
 * batch only ever ADDS sets; it never deletes. That snapshot is taken once and
 * `batchReparseWorkouts` then spends minutes on AI parses, chunk by chunk, so
 * by the time a late chunk is written the athlete may have opened one of those
 * workouts and logged sets by hand (or parsed it on its own). This used to run
 * `DELETE ... WHERE workout_log_id IN (chunk)` and then insert, which silently
 * replaced those hand-logged rows with the AI's guess. D17
 * (CODEBASE_ANALYSIS_2026-10-03): the earlier transaction-only fix stopped the
 * loss on a failed insert but not on a successful one.
 *
 * So inside the transaction the chunk's `workout_logs` rows are locked FOR
 * UPDATE and re-checked: a workout that has gained sets since the snapshot, or
 * has been deleted, is skipped and its parse is discarded. The lock is what
 * makes the re-check hold until commit: inserting a set takes FOR KEY SHARE on
 * its workout_logs row through the foreign key, which FOR UPDATE blocks.
 *
 * The insert is still one multi-row statement across the chunk, so a single
 * rejected row (a CHECK violation from a misparse) fails it for every workout
 * in the chunk; the transaction rolls back and they are all counted `failed`.
 */
export async function saveParsedWorkoutsBatch(
  workouts: { workoutId: string; setRows: InsertExerciseSet[] }[],
): Promise<{ saved: number; failed: number; skipped: number }> {
  if (workouts.length === 0) return { saved: 0, failed: 0, skipped: 0 };

  const workoutIds = workouts.map((w) => w.workoutId);

  try {
    const saved = await db.transaction(async (tx) => {
      const lockedLogs = await tx
        .select({ id: workoutLogs.id })
        .from(workoutLogs)
        .where(inArray(workoutLogs.id, workoutIds))
        .orderBy(workoutLogs.id)
        .for("update");
      const logsWithSets = await tx
        .selectDistinct({ workoutLogId: exerciseSets.workoutLogId })
        .from(exerciseSets)
        .where(inArray(exerciseSets.workoutLogId, workoutIds));

      const stillPresent = new Set(lockedLogs.map((row) => row.id));
      const alreadyHasSets = new Set(logsWithSets.map((row) => row.workoutLogId));
      const writable = workouts.filter(
        (w) => stillPresent.has(w.workoutId) && !alreadyHasSets.has(w.workoutId),
      );

      const allSetRows = writable.flatMap((w) => w.setRows);
      if (allSetRows.length > 0) {
        await tx.insert(exerciseSets).values(allSetRows);
      }
      return writable.length;
    });

    const skipped = workouts.length - saved;
    if (skipped > 0) {
      // Counts only.
      // bearer:disable javascript_lang_logger_leak
      logger.info(
        { skipped, workoutCount: workouts.length },
        "Batch reparse skipped workouts that gained exercise sets (or were deleted) since the snapshot",
      );
    }
    return { saved, failed: 0, skipped };
  } catch (err) {
    // The transaction rolled back, so nothing was written; the caller counts
    // these workouts as unparsed and they stay eligible for a later reparse.
    logger.error(
      { err, workoutCount: workouts.length },
      "Failed to persist parsed exercise sets during batch reparse; rolled back",
    );
    return { saved: 0, failed: workouts.length, skipped: 0 };
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

/**
 * The write half of the L4 legacy-tail backfill: stamping unit-less
 * `exercise_sets` rows with the unit they were written in.
 *
 * Separate from `legacyUnitAudit` on purpose — that module is read-only and
 * says so, and the gate deciding WHETHER to write should not sit in the same
 * file as the machinery that writes. Separate from the script because the
 * scoping below is the one thing here that can fail catastrophically and
 * silently, so it needs to be reachable from a test.
 *
 * `exercise_sets` carries no user id. Every statement therefore scopes through
 * `workout_logs`, and getting that subquery wrong would not throw — it would
 * stamp EVERY athlete's rows with ONE athlete's unit, converting the whole
 * table by ~2.2x. `legacyUnitBackfill.test.ts` pins it.
 */

import { exerciseSets, workoutLogs } from "@shared/schema";
import { and, count, eq, inArray, isNull, type SQL } from "drizzle-orm";

import { db } from "../db";

export type UnitColumn = "weight" | "distance";

function unitColumnFor(column: UnitColumn) {
  return column === "weight" ? exerciseSets.weightUnit : exerciseSets.distanceUnit;
}

/**
 * "Rows belonging to this athlete whose `<column>_unit` is still NULL."
 *
 * Both halves are load-bearing. The NULL test is what makes the backfill
 * idempotent and what stops it touching a row written after the migration — a
 * stamped row already knows its unit, and overwriting it with the athlete's
 * CURRENT preference is precisely the corruption this whole exercise avoids.
 * The subquery is what keeps one athlete's stamp on one athlete's rows.
 */
export function unstampedRowsOf(userId: string, column: UnitColumn): SQL | undefined {
  return and(
    isNull(unitColumnFor(column)),
    inArray(
      exerciseSets.workoutLogId,
      db.select({ id: workoutLogs.id }).from(workoutLogs).where(eq(workoutLogs.userId, userId)),
    ),
  );
}

/** The UPDATE, un-executed. Returned rather than run so a test can read the SQL
 *  it would issue without needing a database. */
export function stampUpdateFor(userId: string, column: UnitColumn, unit: string) {
  const set = column === "weight" ? { weightUnit: unit } : { distanceUnit: unit };
  return db.update(exerciseSets).set(set).where(unstampedRowsOf(userId, column));
}

export async function countUnstamped(userId: string, column: UnitColumn): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(exerciseSets)
    .where(unstampedRowsOf(userId, column));
  return row?.n ?? 0;
}

/**
 * One athlete, one transaction.
 *
 * A half-stamped athlete — weights labelled, distances not — is a worse state
 * than an unstamped one, because the two columns would then disagree about
 * which era the row belongs to.
 *
 * Both statements stamp unconditionally within their NULL filter, including
 * rows whose value is itself NULL. That matches `buildExerciseSetRow` on the
 * write path, which also stamps unconditionally, and it keeps "unit IS NULL"
 * meaning exactly one thing afterwards: a legacy row nobody has cleared yet.
 */
export async function stampLegacyRowsForUser(
  userId: string,
  stamp: { readonly weightUnit: string; readonly distanceUnit: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(exerciseSets)
      .set({ weightUnit: stamp.weightUnit })
      .where(unstampedRowsOf(userId, "weight"));
    await tx
      .update(exerciseSets)
      .set({ distanceUnit: stamp.distanceUnit })
      .where(unstampedRowsOf(userId, "distance"));
  });
}

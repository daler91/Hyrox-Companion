import { exerciseSets, type InsertWorkoutLog, planDays, trainingPlans, workoutLogs } from "@shared/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import { AppError, ErrorCode } from "../errors";

export interface CombineWorkoutsInput {
  readonly userId: string;
  /** The merged workout that replaces the sources. */
  readonly newWorkout: InsertWorkoutLog;
  /** The source workouts to delete once the merged one exists (1..10). */
  readonly deleteWorkoutIds: readonly string[];
  /** Plan days the sources were linked to that should read as skipped afterwards. */
  readonly skipPlanDayIds?: readonly string[];
}

/**
 * Merge several logged workouts into one: insert the merged log, move the
 * sources' logged sets onto it, delete the sources, and mark any plan days
 * they were linked to (other than the one the merged log keeps) as skipped —
 * all in one transaction, all userId-scoped.
 *
 * Lived inline in the /workouts/combine route handler as the only
 * `db.transaction` in server/routes; its own comment recorded a fix that had
 * to be ported by hand from bulkDeleteWorkouts. A service module with a test
 * is where that logic belongs (A3).
 *
 * Refuses (400) to combine a source that is linked to a plan day the caller
 * neither keeps nor skips: silently deleting it would leave that day
 * "completed" with no workout behind it.
 */
export async function combineWorkouts({
  userId,
  newWorkout,
  deleteWorkoutIds,
  skipPlanDayIds,
}: CombineWorkoutsInput): Promise<typeof workoutLogs.$inferSelect> {
  return db.transaction(async (tx) => {
    const sourceWorkouts = await tx
      .select({ id: workoutLogs.id, planDayId: workoutLogs.planDayId })
      .from(workoutLogs)
      .where(and(inArray(workoutLogs.id, [...deleteWorkoutIds]), eq(workoutLogs.userId, userId)));
    if (sourceWorkouts.length !== deleteWorkoutIds.length) {
      throw new AppError(ErrorCode.NOT_FOUND, "One or more source workouts not found", 404);
    }

    const keptPlanDayId = newWorkout.planDayId ?? null;
    if (keptPlanDayId) {
      const owned = await tx
        .select({ id: planDays.id })
        .from(planDays)
        .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
        .where(and(eq(planDays.id, keptPlanDayId), eq(trainingPlans.userId, userId)))
        .limit(1);
      if (owned.length === 0) {
        throw new AppError(ErrorCode.NOT_FOUND, "Plan day not found", 404);
      }
    }

    const skipIds = (skipPlanDayIds ?? []).filter((id) => id !== keptPlanDayId);
    const allowed = new Set<string>(skipIds);
    if (keptPlanDayId) allowed.add(keptPlanDayId);

    for (const src of sourceWorkouts) {
      if (src.planDayId && !allowed.has(src.planDayId)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Cannot combine: source workout ${src.id} is linked to plan day ${src.planDayId}, which isn't the kept plan day or in skipPlanDayIds.`,
          400,
        );
      }
    }

    const [created] = await tx.insert(workoutLogs).values({ ...newWorkout, userId }).returning();

    // Re-parent the sources' logged sets onto the merged workout BEFORE the
    // delete below. exercise_sets.workout_log_id cascades on delete, so
    // without this step combining silently destroyed every structured set
    // both sources carried — the rows every PR, analytics and progression
    // view is built on, with no warning and a "Workouts combined!" toast.
    // Ownership stays workoutLog-side, so exercise_set_single_owner_check
    // holds and this is an in-place update rather than the lossy re-insert
    // an owner-type change would force: ids, unit stamps (L4), prescription
    // snapshots and lock versions all survive.
    const sourceSets = await tx
      .select({ id: exerciseSets.id, exerciseName: exerciseSets.exerciseName })
      .from(exerciseSets)
      .innerJoin(workoutLogs, eq(exerciseSets.workoutLogId, workoutLogs.id))
      .where(and(inArray(exerciseSets.workoutLogId, [...deleteWorkoutIds]), eq(workoutLogs.userId, userId)))
      .orderBy(
        asc(workoutLogs.date),
        asc(workoutLogs.startedAt),
        asc(workoutLogs.id),
        asc(exerciseSets.sortOrder),
        asc(exerciseSets.setNumber),
      );

    if (sourceSets.length > 0) {
      // Renumber across the merged group: sortOrder drives every read path's
      // ordering, and setNumber is the per-exercise label the set editor
      // renders and sorts on, so two sources each holding "Squat" sets 1-3
      // must come out as 1-6 rather than two colliding 1-3 runs.
      const setNumberByExercise = new Map<string, number>();
      const renumbered = sourceSets.map((s, index) => {
        const nextSetNumber = (setNumberByExercise.get(s.exerciseName) ?? 0) + 1;
        setNumberByExercise.set(s.exerciseName, nextSetNumber);
        return { id: s.id, sortOrder: index, setNumber: nextSetNumber };
      });

      // One batch update via CASE rather than a round trip per set (combine
      // accepts up to 10 sources, so this can be several hundred rows).
      const sortChunks = [sql`CASE ${exerciseSets.id} `];
      const numberChunks = [sql`CASE ${exerciseSets.id} `];
      for (const r of renumbered) {
        sortChunks.push(sql`WHEN ${r.id} THEN ${r.sortOrder}::integer `);
        numberChunks.push(sql`WHEN ${r.id} THEN ${r.setNumber}::integer `);
      }
      sortChunks.push(sql`END`);
      numberChunks.push(sql`END`);

      await tx
        .update(exerciseSets)
        .set({
          workoutLogId: created.id,
          sortOrder: sql.join(sortChunks, sql``),
          setNumber: sql.join(numberChunks, sql``),
        })
        .where(inArray(exerciseSets.id, renumbered.map((r) => r.id)));
    }

    // One `inArray` delete rather than one round trip per source id, so the
    // row locks on workout_logs are held for as short a time as possible.
    // The sources' exercise_sets have already moved to `created` above, so
    // the cascade now has nothing of the athlete's to take.
    await tx
      .delete(workoutLogs)
      .where(and(inArray(workoutLogs.id, [...deleteWorkoutIds]), eq(workoutLogs.userId, userId)));

    if (skipIds.length) {
      const userPlanIds = tx
        .select({ id: trainingPlans.id })
        .from(trainingPlans)
        .where(eq(trainingPlans.userId, userId));
      await tx
        .update(planDays)
        .set({ status: "skipped" })
        .where(and(inArray(planDays.id, skipIds), inArray(planDays.planId, userPlanIds)));
    }

    return created;
  });
}

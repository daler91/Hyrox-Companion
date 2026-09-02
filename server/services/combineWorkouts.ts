import { type InsertWorkoutLog, planDays, trainingPlans, workoutLogs } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";

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
 * Merge several logged workouts into one: insert the merged log, delete the
 * sources, and mark any plan days they were linked to (other than the one the
 * merged log keeps) as skipped — all in one transaction, all userId-scoped.
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

    // One `inArray` delete rather than one round trip per source id, so the
    // row locks on workout_logs are held for as short a time as possible.
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

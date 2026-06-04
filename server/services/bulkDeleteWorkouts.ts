import { planDays, trainingPlans, workoutLogs } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../db";
import { AppError, ErrorCode } from "../errors";
import { syncPlanDayStatusFromWorkouts } from "../storage/planDayStatus";

export const BULK_DELETE_WORKOUTS_NOT_FOUND = "One or more workouts were not found";

export interface BulkDeleteWorkoutsInput {
  readonly userId: string;
  readonly workoutLogIds: string[];
  readonly planDayIds: string[];
}

export interface BulkDeleteWorkoutsResult {
  readonly success: true;
  readonly deletedWorkoutLogIds: string[];
  readonly deletedPlanDayIds: string[];
  readonly deletedCount: number;
}

function assertAllTargetsMatched(actualCount: number, expectedCount: number): void {
  if (actualCount !== expectedCount) {
    throw new AppError(ErrorCode.NOT_FOUND, BULK_DELETE_WORKOUTS_NOT_FOUND, 404);
  }
}

function wasDeleted(rowCount: number | null, expectedCount: number): boolean {
  return rowCount !== null && rowCount === expectedCount;
}

export function isBulkDeleteWorkoutsNotFoundError(error: unknown): boolean {
  return error instanceof AppError && error.code === ErrorCode.NOT_FOUND;
}

export async function bulkDeleteWorkouts({
  userId,
  workoutLogIds,
  planDayIds,
}: BulkDeleteWorkoutsInput): Promise<BulkDeleteWorkoutsResult> {
  return db.transaction(async (tx) => {
    const sourceWorkouts = workoutLogIds.length
      ? await tx
        .select({ id: workoutLogs.id, planDayId: workoutLogs.planDayId })
        .from(workoutLogs)
        .where(and(inArray(workoutLogs.id, workoutLogIds), eq(workoutLogs.userId, userId)))
      : [];
    assertAllTargetsMatched(sourceWorkouts.length, workoutLogIds.length);

    const ownedPlanDays = planDayIds.length
      ? await tx
        .select({ id: planDays.id })
        .from(planDays)
        .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
        .where(and(inArray(planDays.id, planDayIds), eq(trainingPlans.userId, userId)))
      : [];
    assertAllTargetsMatched(ownedPlanDays.length, planDayIds.length);

    if (workoutLogIds.length) {
      const deleted = await tx
        .delete(workoutLogs)
        .where(and(inArray(workoutLogs.id, workoutLogIds), eq(workoutLogs.userId, userId)));
      if (!wasDeleted(deleted.rowCount, workoutLogIds.length)) {
        throw new AppError(ErrorCode.NOT_FOUND, BULK_DELETE_WORKOUTS_NOT_FOUND, 404);
      }

      const linkedPlanDayIds = new Set(
        sourceWorkouts
          .map((workout) => workout.planDayId)
          .filter((planDayId): planDayId is string => Boolean(planDayId)),
      );
      // Sequential on purpose: these share the single transaction connection
      // (`tx`), so Promise.all here would throw "another query is already in
      // progress". The set is bounded by the workouts being deleted; the path
      // to fewer round-trips is a bulk-update variant of
      // syncPlanDayStatusFromWorkouts (accepting an id array), not concurrency.
      for (const planDayId of linkedPlanDayIds) {
        await syncPlanDayStatusFromWorkouts(planDayId, userId, tx);
      }
    }

    if (planDayIds.length) {
      const userPlanIds = tx
        .select({ id: trainingPlans.id })
        .from(trainingPlans)
        .where(eq(trainingPlans.userId, userId));
      const deleted = await tx
        .delete(planDays)
        .where(and(inArray(planDays.id, planDayIds), inArray(planDays.planId, userPlanIds)));
      if (!wasDeleted(deleted.rowCount, planDayIds.length)) {
        throw new AppError(ErrorCode.NOT_FOUND, BULK_DELETE_WORKOUTS_NOT_FOUND, 404);
      }
    }

    return {
      success: true,
      deletedWorkoutLogIds: workoutLogIds,
      deletedPlanDayIds: planDayIds,
      deletedCount: workoutLogIds.length + planDayIds.length,
    };
  });
}

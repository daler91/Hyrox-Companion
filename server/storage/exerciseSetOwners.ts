import type { ExerciseSet, InsertExerciseSet } from "@shared/schema";
import { exerciseSets, planDays, trainingPlans, workoutLogs } from "@shared/schema";
import { and, eq } from "drizzle-orm";

import type { Tx } from "../db";

/**
 * An exercise set hangs off exactly one of two containers: a logged workout
 * (`workout_logs`) or a prescribed plan day (`plan_days`). The two differ only
 * in which column carries the parent, how ownership is proved, and how the
 * sibling set rows are scoped — so the write paths in WorkoutStorage take an
 * adapter rather than branching on the kind at every step.
 */

export type MutationOwnerContext =
  | { kind: "workout"; id: string; userId: string }
  | { kind: "planDay"; id: string; userId: string };

export type NormalizedSetCreateInput = Omit<
  InsertExerciseSet,
  "id" | "workoutLogId" | "planDayId" | "sortOrder"
>;

export type MutationOwnerAdapter = {
  getContainerId: (set: ExerciseSet) => string | null;
  /**
   * Ownership check that also takes a row lock on the container, for the insert
   * path that derives sortOrder from the container's current MAX. Returns false
   * when the container doesn't exist or isn't this user's — it is the whole
   * ownership check on that path, not an addition to one.
   */
  lockOwnedContainer: (tx: Tx, containerId: string, userId: string) => Promise<boolean>;
  buildInsertValues: (
    containerId: string,
    set: NormalizedSetCreateInput,
    sortOrder: number,
  ) => InsertExerciseSet;
  scopeWhere: (containerId: string) => ReturnType<typeof eq>;
};

export function getMutationOwnerAdapter(context: MutationOwnerContext): MutationOwnerAdapter {
  if (context.kind === "workout") {
    return {
      getContainerId: (set) => set.workoutLogId,
      lockOwnedContainer: async (tx, containerId, userId) => {
        const [row] = await tx
          .select({ id: workoutLogs.id })
          .from(workoutLogs)
          .where(and(eq(workoutLogs.id, containerId), eq(workoutLogs.userId, userId)))
          .for("update")
          .limit(1);
        return !!row;
      },
      buildInsertValues: (containerId, set, sortOrder) => ({
        ...set,
        workoutLogId: containerId,
        planDayId: null,
        sortOrder,
      }),
      scopeWhere: (containerId) => eq(exerciseSets.workoutLogId, containerId),
    };
  }

  return {
    getContainerId: (set) => set.planDayId,
    lockOwnedContainer: async (tx, containerId, userId) => {
      // Lock the plan day only, not the joined training plan: locking the plan
      // would serialize inserts across every day in it.
      const [row] = await tx
        .select({ id: planDays.id })
        .from(planDays)
        .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
        .where(and(eq(planDays.id, containerId), eq(trainingPlans.userId, userId)))
        .for("update", { of: planDays })
        .limit(1);
      return !!row;
    },
    buildInsertValues: (containerId, set, sortOrder) => ({
      ...set,
      planDayId: containerId,
      workoutLogId: null,
      sortOrder,
    }),
    scopeWhere: (containerId) => eq(exerciseSets.planDayId, containerId),
  };
}

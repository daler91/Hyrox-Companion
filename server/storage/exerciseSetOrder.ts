import { type ExerciseSet, exerciseSets } from "@shared/schema";
import { sql } from "drizzle-orm";

import { db } from "../db";
import { AppError, ErrorCode } from "../errors";
import { getMutationOwnerAdapter, type MutationOwnerContext } from "./exerciseSetOwners";

/** True when `setIds` names every stored set exactly once (the body schema rules out repeats). */
function namesEverySet(stored: readonly { id: string }[], setIds: readonly string[]): boolean {
  if (stored.length !== setIds.length) return false;
  const named = new Set(setIds);
  return stored.every(({ id }) => named.has(id));
}

function bySortOrder(left: ExerciseSet, right: ExerciseSet): number {
  return (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
}

/** The container a set-level route addresses, as WorkoutStorage's set routes take it. */
type SetOrderOwner = { kind: "workoutLog" | "planDay"; ownerId: string };

/**
 * Saves the whole order of one workout's or plan day's sets in one
 * transaction: each set's `sortOrder` becomes its index in `setIds`. A drag
 * used to send one PATCH per moved set, so a long list could hit the set-write
 * rate limit part way through, and a partial failure split an exercise between
 * the saved and the unsaved rows. PF5 (CODEBASE_ANALYSIS_2026-10-03)
 *
 * The container's row lock is the ownership check, as on the insert path, and
 * also serializes this against a set being added or removed. `setIds` must name
 * exactly the sets the container holds: a list read before another device
 * added or removed one is refused with 409 rather than saved over the change.
 *
 * `version` is left alone. It guards a set's values against another device's
 * write, and a new position overwrites none of them; bumping it would make the
 * next cell edit from the tab that dragged (which still holds the old version)
 * fail as a conflict.
 *
 * Resolves to the sets in their new order, or undefined when the container
 * does not exist or is not this user's.
 */
function saveExerciseSetOrder(
  context: MutationOwnerContext,
  setIds: readonly string[],
): Promise<ExerciseSet[] | undefined> {
  const adapter = getMutationOwnerAdapter(context);
  return db.transaction(async (tx) => {
    if (!(await adapter.lockOwnedContainer(tx, context.id, context.userId))) return undefined;
    const stored = await tx
      .select({ id: exerciseSets.id })
      .from(exerciseSets)
      .where(adapter.scopeWhere(context.id));
    if (!namesEverySet(stored, setIds)) {
      throw new AppError(
        ErrorCode.CONFLICT,
        "The exercise list changed since it was loaded. Reload it and try again.",
        409,
      );
    }
    const positions = setIds.map((id, position) => sql`when ${id} then ${position}::integer`);
    const updated = await tx
      .update(exerciseSets)
      .set({ sortOrder: sql`case ${exerciseSets.id} ${sql.join(positions, sql.raw(" "))} end` })
      .where(adapter.scopeWhere(context.id))
      .returning();
    return updated.sort(bySortOrder);
  });
}

/** The route-facing entry point, bound on WorkoutStorage as `mutateExerciseSetOrder`. */
export function mutateExerciseSetOrder(
  owner: SetOrderOwner,
  setIds: readonly string[],
  userId: string,
): Promise<ExerciseSet[] | undefined> {
  const kind = owner.kind === "workoutLog" ? "workout" : "planDay";
  return saveExerciseSetOrder({ kind, id: owner.ownerId, userId }, setIds);
}

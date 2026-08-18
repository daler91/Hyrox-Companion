import { planDays, trainingPlans, workoutLogs } from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db, type DbExecutor } from "../db";

/**
 * Re-derive plan_day.status from the current workout_logs count (S6).
 *
 * Lives in its own module to avoid a circular import chain — plans.ts
 * transitively pulls in the aggregate storage object via types.ts →
 * clerkAuth.ts → storage/index.ts, which breaks when workouts.ts (one of
 * storage/index.ts's dependencies) tries to call the helper during load.
 *
 * Semantics:
 *   - "skipped" and "missed" are explicit user/cron intent — never override.
 *   - Otherwise: "completed" iff any workout_log references this plan_day,
 *     "planned" when zero. (The missed-day cron will re-mark past-dated
 *     "planned" days on its next run, so ping-ponging is not a concern.)
 *
 * Ownership is enforced by joining the plan_day's parent plan; the function
 * is a no-op if the plan_day doesn't belong to `userId`.
 *
 * Concurrency: takes SELECT FOR UPDATE on the plan_day row to serialize
 * with concurrent createWorkoutLog paths that update the same row. Without
 * the lock, a concurrent INSERT could commit between our count query and
 * our UPDATE, causing us to overwrite a freshly-"completed" plan_day back
 * to "planned". When called outside an existing transaction we open our
 * own so the row lock actually holds across statements.
 */
export function syncPlanDayStatusFromWorkouts(
  planDayId: string,
  userId: string,
  tx?: DbExecutor,
): Promise<void> {
  if (tx) return syncInTransaction(planDayId, userId, tx);
  return db.transaction((newTx) => syncInTransaction(planDayId, userId, newTx));
}

async function syncInTransaction(planDayId: string, userId: string, tx: DbExecutor): Promise<void> {
  // SELECT FOR UPDATE on plan_days only (not training_plans) — locks the
  // single row whose status we may update. createWorkoutLog's subsequent
  // UPDATE on this row will block until our transaction commits.
  const [row] = await tx
    .select({
      status: planDays.status,
      ownerId: trainingPlans.userId,
    })
    .from(planDays)
    .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
    .where(eq(planDays.id, planDayId))
    .for("update", { of: planDays });

  if (row?.ownerId !== userId) return;
  if (row.status === "skipped" || row.status === "missed") return;

  const [counted] = await tx
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(workoutLogs)
    .where(and(eq(workoutLogs.planDayId, planDayId), eq(workoutLogs.userId, userId)));

  const nextStatus: "planned" | "completed" = (counted?.count ?? 0) > 0 ? "completed" : "planned";
  if (row.status === nextStatus) return;

  await tx.update(planDays).set({ status: nextStatus }).where(eq(planDays.id, planDayId));
}

/**
 * Batched sibling of {@link syncPlanDayStatusFromWorkouts} for callers that
 * need to re-derive status for several plan_days at once (e.g. bulk delete,
 * which previously called the single-id version once per affected plan_day
 * inside a `for` loop — N sequential SELECT FOR UPDATE + COUNT + UPDATE round
 * trips on the same transaction connection). This does the same work in at
 * most 3 round trips total, independent of `planDayIds.length`:
 *   1. One `SELECT ... FOR UPDATE` locking all candidate rows at once.
 *   2. One grouped COUNT over workout_logs for all candidate plan_days.
 *   3. Up to two UPDATEs (one per target status) covering every row that
 *      actually needs to change.
 *
 * Semantics are identical to the single-id version, applied per row:
 * "skipped"/"missed" are never overridden, ownership is enforced per row,
 * and a row already at its derived status is left untouched.
 */
export function syncPlanDayStatusesFromWorkouts(
  planDayIds: readonly string[],
  userId: string,
  tx?: DbExecutor,
): Promise<void> {
  if (planDayIds.length === 0) return Promise.resolve();
  if (tx) return syncManyInTransaction(planDayIds, userId, tx);
  return db.transaction((newTx) => syncManyInTransaction(planDayIds, userId, newTx));
}

async function syncManyInTransaction(
  planDayIds: readonly string[],
  userId: string,
  tx: DbExecutor,
): Promise<void> {
  const rows = await tx
    .select({
      id: planDays.id,
      status: planDays.status,
      ownerId: trainingPlans.userId,
    })
    .from(planDays)
    .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
    .where(inArray(planDays.id, planDayIds))
    .for("update", { of: planDays });

  const eligible = rows.filter(
    (row) => row.ownerId === userId && row.status !== "skipped" && row.status !== "missed",
  );
  if (eligible.length === 0) return;

  const counts = await tx
    .select({
      planDayId: workoutLogs.planDayId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(workoutLogs)
    .where(
      and(
        inArray(
          workoutLogs.planDayId,
          eligible.map((row) => row.id),
        ),
        eq(workoutLogs.userId, userId),
      ),
    )
    .groupBy(workoutLogs.planDayId);
  const countByPlanDayId = new Map(counts.map((row) => [row.planDayId, row.count]));

  const toComplete: string[] = [];
  const toPlan: string[] = [];
  for (const row of eligible) {
    const nextStatus: "planned" | "completed" =
      (countByPlanDayId.get(row.id) ?? 0) > 0 ? "completed" : "planned";
    if (row.status === nextStatus) continue;
    (nextStatus === "completed" ? toComplete : toPlan).push(row.id);
  }

  if (toComplete.length) {
    await tx.update(planDays).set({ status: "completed" }).where(inArray(planDays.id, toComplete));
  }
  if (toPlan.length) {
    await tx.update(planDays).set({ status: "planned" }).where(inArray(planDays.id, toPlan));
  }
}

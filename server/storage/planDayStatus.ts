import { planDays, trainingPlans, workoutLogs } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";

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

async function syncInTransaction(
  planDayId: string,
  userId: string,
  tx: DbExecutor,
): Promise<void> {
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
    .where(
      and(
        eq(workoutLogs.planDayId, planDayId),
        eq(workoutLogs.userId, userId),
      ),
    );

  const nextStatus: "planned" | "completed" = (counted?.count ?? 0) > 0 ? "completed" : "planned";
  if (row.status === nextStatus) return;

  await tx
    .update(planDays)
    .set({ status: nextStatus })
    .where(eq(planDays.id, planDayId));
}

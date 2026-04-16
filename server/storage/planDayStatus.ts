import { planDays, workoutLogs } from "@shared/schema";
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
 */
export async function syncPlanDayStatusFromWorkouts(
  planDayId: string,
  userId: string,
  tx?: DbExecutor,
): Promise<void> {
  const executor = tx ?? db;

  const day = await executor.query.planDays.findFirst({
    where: eq(planDays.id, planDayId),
    with: { plan: { columns: { userId: true } } },
  });
  if (!day || day.plan?.userId !== userId) return;
  if (day.status === "skipped" || day.status === "missed") return;

  const [row] = await executor
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(workoutLogs)
    .where(
      and(
        eq(workoutLogs.planDayId, planDayId),
        eq(workoutLogs.userId, userId),
      ),
    );

  const nextStatus: "planned" | "completed" = (row?.count ?? 0) > 0 ? "completed" : "planned";
  if (day.status === nextStatus) return;

  await executor
    .update(planDays)
    .set({ status: nextStatus })
    .where(eq(planDays.id, planDayId));
}

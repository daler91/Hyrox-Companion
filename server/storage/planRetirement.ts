import { planDays, trainingPlans } from "@shared/schema";
import { and, eq, gte, inArray, isNotNull, lt, notExists, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

// Type-only, so this module still pulls in no database connection and stays
// importable from the driverless SQL-rendering test.
import type { db } from "../db";

type Executor = Pick<typeof db, "select">;

/**
 * Guards for `training_plans.retired_on` — the plan-lifecycle column.
 *
 * NULL means the plan is live. A date means the athlete stopped training it that
 * day (they switched goals, or archived it by hand), and the date itself is
 * EXCLUDED: a plan retired on D is the athlete's plan for every date < D.
 *
 * Both predicates live here, rather than inline at each query, because they have
 * to agree exactly. They are two readings of one rule — "was this plan live on
 * this date?" — and the day a `>` here drifts against a `>=` there, the adherence
 * denominator silently stops matching the timeline the athlete is looking at.
 * `server/storage/__tests__/absenceGuardSql.test.ts` imports these directly so the
 * rendered SQL is asserted against the real predicate rather than a copy of it.
 */

/**
 * True for a plan that is an honest answer to "what was the athlete training on
 * `date`?". Use when selecting among PLANS for a given day — `getPlanForDate` and
 * everything downstream of it.
 *
 * A retired plan must also COVER the date, not merely predate its retirement.
 * `getPlanForDate` falls back to the most-recently-ended and next-upcoming plan
 * when nothing covers the date, and a bare `retired_on > date` still satisfies
 * every date before the cutoff — so a plan archived before it ever started would
 * sail into the "next upcoming" slot and be handed back as the athlete's plan.
 * That is the very bug this column exists to kill, in mirror image. Live plans
 * keep the fallbacks; retired ones answer only for the stretch they actually ran.
 */
export function planLiveForDate(date: string): SQL {
  return sql`(
    ${trainingPlans.retiredOn} IS NULL
    OR (
      ${trainingPlans.retiredOn} > ${date}
      AND ${trainingPlans.startDate} <= ${date}
      AND ${trainingPlans.endDate} >= ${date}
    )
  )`;
}

/**
 * True for a plan day that fell while its own plan was still live. Use when
 * counting or sweeping PLAN DAYS across a window, where each row carries its own
 * date — the missed sweep and the adherence denominator.
 *
 * Half-open `[start, retired_on)`, matching `planLiveForDate`. Correlated on the
 * outer `plan_days` row, so it may only be used where `plan_days` is in scope.
 *
 * `plan` is the `training_plans` reference to read the cutoff from; pass an alias
 * when the statement already mentions `training_plans` for another purpose, so it
 * is unambiguous which one is meant.
 */
export function planDayWithinPlanLifetime(plan: typeof trainingPlans = trainingPlans): SQL {
  return sql`(
    ${plan.retiredOn} IS NULL
    OR ${planDays.scheduledDate} < ${plan.retiredOn}
  )`;
}

/**
 * The same half-open rule, expressed against an already-fetched list of plans
 * instead of a join — for the timeline's relational (`db.query…findMany`) reads,
 * which resolve the athlete's plans first and then filter days by plan id.
 *
 * Returns a condition to use in place of a bare `inArray(planDays.planId, ids)`:
 * live plans contribute all their days, retired ones only the days before their
 * cutoff. Stays in SQL rather than filtering after the fetch, because both
 * callers apply a row limit — a post-fetch filter would silently return fewer
 * rows than asked for.
 *
 * `undefined` when the athlete has no plans at all; callers already short-circuit
 * on the empty case.
 */
export function planDaysWithinLifetimes(
  plans: readonly { id: string; retiredOn: string | null }[],
): SQL | undefined {
  const liveIds = plans.filter((p) => p.retiredOn == null).map((p) => p.id);
  const retired = plans.filter(
    (p): p is { id: string; retiredOn: string } => p.retiredOn != null,
  );

  const clauses: SQL[] = [];
  if (liveIds.length > 0) clauses.push(inArray(planDays.planId, liveIds));
  for (const plan of retired) {
    clauses.push(
      and(eq(planDays.planId, plan.id), lt(planDays.scheduledDate, plan.retiredOn)) as SQL,
    );
  }

  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : or(...clauses);
}

/**
 * The missed-day sweep's retirement guard: skip any day at or after its own
 * plan's cutoff.
 *
 * Built here rather than inline in the sweep so that
 * `server/storage/__tests__/absenceGuardSql.test.ts` can render the REAL
 * predicate. That test cannot import it from plans.ts — plans.ts pulls in the
 * database module, and the test runs driverless precisely so it can render SQL
 * without a connection — so the alternative was a hand-copied restatement, and
 * a guard asserted against a copy of itself proves nothing.
 *
 * `executor` is only used to build the subquery AST; nothing is executed.
 *
 * Aliased because the sweep also mentions training_plans inside its absence
 * guard. Rewriting the outer UPDATE as `UPDATE ... FROM training_plans` would
 * put an unaliased copy in scope that silently shadows that guard's own join —
 * legal SQL, wrong results.
 *
 * Correlated per DAY, not decidable at plan granularity: a partially retired
 * plan must still have its EARLIER days swept, since that stretch is real
 * history the athlete actually lived.
 */
export function missedSweepRetirementGuard(executor: Executor): SQL {
  const retiredPlan = alias(trainingPlans, "retired_plan");
  return notExists(
    executor
      .select({ one: sql`1` })
      .from(retiredPlan)
      .where(
        and(
          eq(retiredPlan.id, planDays.planId),
          isNotNull(retiredPlan.retiredOn),
          gte(planDays.scheduledDate, retiredPlan.retiredOn),
        ),
      ),
  );
}

import { planDays, timelineAnnotations, trainingPlans } from "@shared/schema";
import { and, eq, exists, gte, lte, notExists, type SQL, sql } from "drizzle-orm";

// Type-only, so this module still pulls in no database connection and stays
// importable from the driverless SQL-rendering test.
import type { db } from "../db";

type Executor = Pick<typeof db, "select">;

/**
 * Guards for declared absences — timeline annotations covering a date.
 *
 * An athlete who has written "injured, 12–19 Aug" on their timeline has already
 * accounted for that stretch; the sweep, the missed-workout reminder, and the
 * weekly email's excused split must all read that declaration by the same rule.
 * All three render as *correlated* (NOT) EXISTS, and an uncorrelated rewrite
 * fails in the worst possible direction: one annotation anywhere in the table
 * would excuse everybody's days, silently, with no error to notice.
 *
 * Built here rather than inline at each query so that
 * `server/storage/__tests__/absenceGuardSql.test.ts` can render the REAL
 * predicates without a database connection — a guard asserted against a
 * hand-copied twin of itself proves nothing about the query that actually runs.
 *
 * `executor` is only used to build the subquery AST; nothing is executed.
 */

/**
 * True when no declared absence covers the outer `plan_days` row — the missed
 * sweep's guard. Correlated on the plan's owner rather than on plan_days
 * directly: plan_days carries no user_id, so the annotation has to be reached
 * through training_plans. Uses idx_timeline_annotations_user_range.
 */
export function noAbsenceDeclaredForPlanDay(executor: Executor): SQL {
  return notExists(
    executor
      .select({ one: sql`1` })
      .from(timelineAnnotations)
      .innerJoin(trainingPlans, eq(trainingPlans.id, planDays.planId))
      .where(
        and(
          eq(timelineAnnotations.userId, trainingPlans.userId),
          lte(timelineAnnotations.startDate, planDays.scheduledDate),
          gte(timelineAnnotations.endDate, planDays.scheduledDate),
        ),
      ),
  );
}

/**
 * True when no declared absence covers `date` for `userId` — the missed-workout
 * reminder's guard. Bound parameters, not a cross-user correlation: the
 * reminder already knows whose day it is asking about.
 */
export function noAbsenceDeclaredForUserDate(executor: Executor, userId: string, date: string): SQL {
  return notExists(
    executor
      .select({ one: sql`1` })
      .from(timelineAnnotations)
      .where(
        and(
          eq(timelineAnnotations.userId, userId),
          lte(timelineAnnotations.startDate, date),
          gte(timelineAnnotations.endDate, date),
        ),
      ),
  );
}

/**
 * True when a declared absence of `userId` covers the outer `plan_days` row —
 * the weekly email's excused split. Positive EXISTS, correlated on each day's
 * own scheduled_date, so it may only be used where `plan_days` is in scope.
 */
export function absenceDeclaredForPlanDay(executor: Executor, userId: string): SQL {
  return exists(
    executor
      .select({ one: sql`1` })
      .from(timelineAnnotations)
      .where(
        and(
          eq(timelineAnnotations.userId, userId),
          lte(timelineAnnotations.startDate, planDays.scheduledDate),
          gte(timelineAnnotations.endDate, planDays.scheduledDate),
        ),
      ),
  );
}

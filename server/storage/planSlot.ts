import { dayDiff, planWeekOneMonday, weekdayName } from "@shared/dateUtils";
import { planDays, trainingPlans } from "@shared/schema";
import { eq, min } from "drizzle-orm";

import type { DbExecutor } from "../db";

/** Where a session sits in its plan: the week and weekday schedulePlan lays it out from. */
export interface PlanSlot {
  readonly weekNumber: number;
  readonly dayName: string;
}

/**
 * The plan week and weekday `date` falls in: schedulePlan's layout run
 * backwards. schedulePlan puts week W's session for a weekday on week 1's
 * Monday (the plan's start date), plus W minus the first week in weeks, plus
 * that weekday; so a session on `date` belongs to that date's week and
 * weekday. A date before week 1 counts as week 1.
 */
export function planSlotFor(planStartDate: string, firstWeek: number, date: string): PlanSlot {
  const weeksIn = Math.floor(dayDiff(planWeekOneMonday(planStartDate), date) / 7);
  return { weekNumber: firstWeek + Math.max(0, weeksIn), dayName: weekdayName(date) };
}

/**
 * The week and weekday a write that gives a plan day `scheduledDate` must set
 * with it (see planSlotFor), or undefined when it sets no date, clears the
 * date, or the plan has never been scheduled.
 *
 * Moves used to change the date alone, which left a session filed under the
 * week it came from: the timeline showed "Week 6" between two week-5 days, the
 * workout engine read the old week's plan phase, and rescheduling the plan put
 * the session back in its old slot.
 */
export async function planSlotForMove(
  executor: DbExecutor,
  planId: string,
  scheduledDate: string | null | undefined,
): Promise<PlanSlot | undefined> {
  if (typeof scheduledDate !== "string") return undefined;
  const [plan] = await executor
    .select({ startDate: trainingPlans.startDate, firstWeek: min(planDays.weekNumber) })
    .from(trainingPlans)
    .leftJoin(planDays, eq(planDays.planId, trainingPlans.id))
    .where(eq(trainingPlans.id, planId))
    .groupBy(trainingPlans.id);
  if (!plan?.startDate) return undefined;
  return planSlotFor(plan.startDate, plan.firstWeek ?? 1, scheduledDate);
}

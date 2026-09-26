import { planDays } from "@shared/schema";
import { type SQL, sql } from "drizzle-orm";

/**
 * A missed plan day the athlete let go (missed-session recovery). Letting go
 * is a decision about the plan, not a failure to follow it, so the day leaves
 * "missed" and every rate's denominator, the way a declared absence does. Only
 * a day still stored missed: one logged after all is completed, and one whose
 * log was then deleted is an open miss again (the timeline reads it the same
 * way).
 *
 * Never NULL. A bare `recovery = 'let_go'` is NULL on an undecided day, and
 * `NOT` of NULL is NULL — which a WHERE reads as false, dropping every
 * ordinary miss from the denominator it was meant to keep them in.
 *
 * Driverless, like ./absenceGuard, so `__tests__/letGoGuardSql.test.ts` can
 * render the real predicate.
 */
export function planDayLetGo(): SQL {
  return sql`(coalesce(${planDays.status}, '') = 'missed' and coalesce(${planDays.recovery}, '') = 'let_go')`;
}

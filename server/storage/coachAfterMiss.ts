import { addDaysToISODate } from "@shared/dateUtils";
import { trainingPlans, users, workoutLogs } from "@shared/schema";
import { and, eq, exists, gte, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import { getLocalDateStrSafe } from "../timezone";

/**
 * An athlete whose plan lost a session it leans on, for the coach to look at
 * again, with the plans that put them on the list
 * (PlanStorage.takeAthletesToCoachAfterMiss).
 */
export interface AthleteAwaitingCoach {
  readonly userId: string;
  readonly planIds: readonly string[];
}

/** An athlete with no workout logged in this long has stopped: nothing is reviewed for them overnight. */
const COACH_AFTER_MISS_ACTIVE_DAYS = 14;

/**
 * The owners of `planIds` the coach should look at again after a missed
 * session: only athletes with the AI coach on who are still training (a
 * workout logged in the last two weeks). A plan somebody walked away from
 * misses a session every night, and reviewing each one would run the model for
 * nobody. One entry an athlete, with each of their plans among `planIds`.
 */
export async function findAthletesToCoachAfterMiss(
  planIds: readonly string[],
  now: Date,
): Promise<AthleteAwaitingCoach[]> {
  // A UTC date a day early is the widest any athlete's own calendar can be.
  const activeSince = addDaysToISODate(
    getLocalDateStrSafe(now, "Etc/UTC"),
    -(COACH_AFTER_MISS_ACTIVE_DAYS + 1),
  );
  const owners = await db
    .select({ userId: trainingPlans.userId, planId: trainingPlans.id })
    .from(trainingPlans)
    .innerJoin(users, eq(users.id, trainingPlans.userId))
    .where(
      and(
        inArray(trainingPlans.id, [...planIds]),
        eq(users.aiCoachEnabled, true),
        exists(
          db
            .select({ one: sql`1` })
            .from(workoutLogs)
            .where(
              and(eq(workoutLogs.userId, trainingPlans.userId), gte(workoutLogs.date, activeSince)),
            ),
        ),
      ),
    );
  const plansByAthlete = new Map<string, string[]>();
  for (const { userId, planId } of owners) {
    const plans = plansByAthlete.get(userId);
    if (plans) plans.push(planId);
    else plansByAthlete.set(userId, [planId]);
  }
  return [...plansByAthlete].map(([userId, plans]) => ({ userId, planIds: plans }));
}

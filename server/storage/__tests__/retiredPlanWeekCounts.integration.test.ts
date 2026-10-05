import { planDays, timelineAnnotations, trainingPlans, users } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../index";
import { seedUser } from "./integrationDb";

/**
 * AI17 (CODEBASE_ANALYSIS_2026-10-03) siblings, against the REAL schema. A
 * retired plan's days from its cutoff on stay `planned` for good, and the
 * timeline and the weekly review leave them out. The weekly summary email's
 * counts (getWeeklyStats) and the per-meal fuel targets (getPlannedDaysForDate)
 * counted them too: after a mid-week switch the email listed the old plan's
 * remaining sessions as still to do, and a meal on Saturday was fuelled for
 * two long runs.
 *
 * Cleans up only its own athlete rather than resetting the whole database.
 */
describe("retired plans' remaining days stay out of the week's counts (real Postgres)", () => {
  const ATHLETE = "retired-plan-week-athlete";
  const WEEK_START = "2026-06-08";
  const WEEK_END = "2026-06-14";

  async function removeAthlete(): Promise<void> {
    const plans = await db
      .select({ id: trainingPlans.id })
      .from(trainingPlans)
      .where(eq(trainingPlans.userId, ATHLETE));
    if (plans.length > 0) {
      await db.delete(planDays).where(
        inArray(
          planDays.planId,
          plans.map((plan) => plan.id),
        ),
      );
      await db.delete(trainingPlans).where(eq(trainingPlans.userId, ATHLETE));
    }
    await db.delete(timelineAnnotations).where(eq(timelineAnnotations.userId, ATHLETE));
    await db.delete(users).where(eq(users.id, ATHLETE));
  }

  beforeAll(async () => {
    await removeAthlete();
    await seedUser(ATHLETE);
    // Switched mid-week: the old block retired on Thursday, the new one starts then.
    const [retired] = await db
      .insert(trainingPlans)
      .values({
        userId: ATHLETE,
        name: "Old block",
        totalWeeks: 4,
        startDate: "2026-05-18",
        endDate: "2026-06-14",
        retiredOn: "2026-06-11",
      })
      .returning();
    const [live] = await db
      .insert(trainingPlans)
      .values({
        userId: ATHLETE,
        name: "New block",
        totalWeeks: 4,
        startDate: "2026-06-11",
        endDate: "2026-07-05",
      })
      .returning();
    const day = { mainWorkout: "Easy" };
    await db.insert(planDays).values([
      {
        ...day,
        planId: retired.id,
        weekNumber: 4,
        dayName: "Monday",
        focus: "Old easy run",
        scheduledDate: "2026-06-08",
        status: "completed",
      },
      {
        ...day,
        planId: retired.id,
        weekNumber: 4,
        dayName: "Wednesday",
        focus: "Old intervals",
        scheduledDate: "2026-06-10",
        status: "missed",
      },
      // From the cutoff on: left `planned` by design, outside the plan's lifetime.
      {
        ...day,
        planId: retired.id,
        weekNumber: 4,
        dayName: "Thursday",
        focus: "Old tempo",
        scheduledDate: "2026-06-11",
        status: "planned",
      },
      {
        ...day,
        planId: retired.id,
        weekNumber: 4,
        dayName: "Saturday",
        focus: "Old long run",
        scheduledDate: "2026-06-13",
        status: "planned",
        expectedDurationMin: 120,
      },
      {
        ...day,
        planId: live.id,
        weekNumber: 1,
        dayName: "Thursday",
        focus: "New tempo",
        scheduledDate: "2026-06-11",
        status: "completed",
      },
      {
        ...day,
        planId: live.id,
        weekNumber: 1,
        dayName: "Saturday",
        focus: "New long run",
        scheduledDate: "2026-06-13",
        status: "planned",
        expectedDurationMin: 90,
      },
      {
        ...day,
        planId: live.id,
        weekNumber: 1,
        dayName: "Sunday",
        focus: "New recovery",
        scheduledDate: "2026-06-14",
        status: "planned",
      },
    ]);
    // Away on Saturday: an excused day, counted once, for the plan still live.
    await db
      .insert(timelineAnnotations)
      .values({ userId: ATHLETE, startDate: "2026-06-13", endDate: "2026-06-13", type: "travel" });
  });

  afterAll(async () => {
    await removeAthlete();
  });

  it("the weekly email counts only the live plan's remaining and excused days", async () => {
    const stats = await storage.analytics.getWeeklyStats(ATHLETE, WEEK_START, WEEK_END);

    expect(stats).toMatchObject({
      planCompletedCount: 2,
      missedCount: 1,
      // Sunday's recovery; Saturday is excused. Not the old Thursday or Saturday.
      plannedCount: 1,
      excusedCount: 1,
      skippedCount: 0,
      letGoCount: 0,
    });
  });

  it("a meal on Saturday is fuelled for the live plan's long run only", async () => {
    const days = await storage.analytics.getPlannedDaysForDate(ATHLETE, "2026-06-13");

    expect(days).toEqual([
      {
        focus: "New long run",
        expectedDurationMin: 90,
        expectedRpe: null,
        plannedTimeOfDayMin: null,
      },
    ]);
  });
});

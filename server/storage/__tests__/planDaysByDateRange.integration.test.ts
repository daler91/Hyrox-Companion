import { planDays, trainingPlans, users } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../index";
import { seedUser } from "./integrationDb";

/**
 * getPlanDaysByDateRange against the REAL schema: the weekly review's plan
 * days for a week the athlete switched plans in. The retired plan's days
 * before its cutoff are the week they trained it and stay; its days from the
 * cutoff on stay `planned` for good and must not be counted beside the new
 * plan's — AI17 (CODEBASE_ANALYSIS_2026-10-03).
 *
 * Cleans up only its own athlete rather than resetting the whole database.
 */
describe("AnalyticsStorage.getPlanDaysByDateRange (real Postgres)", () => {
  const ATHLETE = "plan-days-range-athlete";

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
    const day = { weekNumber: 4, focus: "Run", mainWorkout: "Easy" };
    await db.insert(planDays).values([
      {
        ...day,
        planId: retired.id,
        dayName: "Monday",
        scheduledDate: "2026-06-08",
        status: "completed",
      },
      {
        ...day,
        planId: retired.id,
        dayName: "Wednesday",
        scheduledDate: "2026-06-10",
        status: "missed",
      },
      // From the cutoff on: left `planned` by design, outside the plan's lifetime.
      {
        ...day,
        planId: retired.id,
        dayName: "Thursday",
        scheduledDate: "2026-06-11",
        status: "planned",
      },
      {
        ...day,
        planId: retired.id,
        dayName: "Saturday",
        scheduledDate: "2026-06-13",
        status: "planned",
      },
      {
        ...day,
        planId: live.id,
        weekNumber: 1,
        dayName: "Thursday",
        scheduledDate: "2026-06-11",
        status: "completed",
      },
      {
        ...day,
        planId: live.id,
        weekNumber: 1,
        dayName: "Saturday",
        scheduledDate: "2026-06-13",
        status: "planned",
      },
    ]);
  });

  afterAll(async () => {
    await removeAthlete();
  });

  it("returns the retired plan's days before its cutoff and none after", async () => {
    const days = await storage.analytics.getPlanDaysByDateRange(
      ATHLETE,
      "2026-06-08",
      "2026-06-14",
    );

    expect(
      days
        .map((d) => `${d.planName ?? ""} ${d.date} ${d.status}`)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual([
      "New block 2026-06-11 completed",
      "New block 2026-06-13 planned",
      "Old block 2026-06-08 completed",
      "Old block 2026-06-10 missed",
    ]);
  });
});

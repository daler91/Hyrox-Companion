import { PLAN_WEEKDAYS } from "@shared/dateUtils";
import { planDays, trainingPlans } from "@shared/schema";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../index";
import { resetIntegrationDb, seedUser } from "./integrationDb";

/**
 * getPlanWeeklyDensity against the REAL schema: the grouped LEFT JOIN, and
 * rest rows left out. An AI-generated plan writes all seven days, rest days
 * included, so counting rows reported 7 sessions a week and the "weekly goal
 * exceeds plan" hint never fired for a normal goal — C41
 * (CODEBASE_ANALYSIS_2026-10-03).
 */
describe("PlanStorage.getPlanWeeklyDensity (real Postgres)", () => {
  const ATHLETE = "density-athlete";
  const TRAINING_DAYS = new Set(["Monday", "Tuesday", "Thursday", "Saturday"]);

  async function seedPlan(totalWeeks: number): Promise<string> {
    const [plan] = await db
      .insert(trainingPlans)
      .values({ userId: ATHLETE, name: "AI Block", totalWeeks })
      .returning();
    return plan.id;
  }

  /** Four sessions and three rest days a week, the way plan generation writes them. */
  async function seedGeneratedWeeks(planId: string, weeks: number) {
    const rows = Array.from({ length: weeks }, (_slot, index) => index + 1).flatMap((weekNumber) =>
      PLAN_WEEKDAYS.map((dayName) =>
        TRAINING_DAYS.has(dayName)
          ? {
              planId,
              weekNumber,
              dayName,
              focus: `${dayName} engine`,
              mainWorkout: `Week ${weekNumber} intervals`,
            }
          : {
              planId,
              weekNumber,
              dayName,
              focus: "Rest",
              mainWorkout: "Complete rest or light walk",
            },
      ),
    );
    await db.insert(planDays).values(rows);
  }

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ATHLETE);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("counts the training days of a generated plan, not its rest days", async () => {
    const planId = await seedPlan(3);
    await seedGeneratedWeeks(planId, 3);

    expect(await storage.plans.getPlanWeeklyDensity(planId)).toBe(4);
  });

  it("still answers zero for a plan with no days left", async () => {
    const planId = await seedPlan(8);

    expect(await storage.plans.getPlanWeeklyDensity(planId)).toBe(0);
  });

  it("answers undefined for a plan that is not there", async () => {
    expect(await storage.plans.getPlanWeeklyDensity("no-such-plan")).toBeUndefined();
  });
});

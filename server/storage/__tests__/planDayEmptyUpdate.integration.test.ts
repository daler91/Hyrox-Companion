import { planDays, trainingPlans } from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../index";
import { resetIntegrationDb, seedUser } from "./integrationDb";

/**
 * Tech debt #37: an update with nothing to write reached drizzle's `.set()`,
 * which throws "No values to set", so an empty PATCH to a plan day (or a status
 * PATCH carrying only skipReason) answered 500. Against the real schema, as the
 * other plan-day storage tests are.
 */
describe("updatePlanDay with nothing to write (real Postgres)", () => {
  const ATHLETE = "empty-update-athlete";
  const OTHER = "empty-update-other";

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ATHLETE);
    await seedUser(OTHER);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  async function seedDay() {
    const [plan] = await db
      .insert(trainingPlans)
      .values({ userId: ATHLETE, name: "Build", totalWeeks: 2, startDate: "2026-08-03" })
      .returning();
    const [day] = await db
      .insert(planDays)
      .values({ planId: plan.id, weekNumber: 1, dayName: "Monday", focus: "Run", mainWorkout: "5 km easy", scheduledDate: "2026-08-03", status: "planned" })
      .returning();
    return day;
  }

  it.each([
    ["an empty update", {}],
    ["an update whose keys are all undefined", { focus: undefined, scheduledDate: undefined }],
  ])("returns the day unchanged for %s, instead of throwing", async (_case, updates) => {
    const day = await seedDay();

    const result = await storage.plans.updatePlanDay(day.id, updates, ATHLETE);

    expect(result).toMatchObject({ id: day.id, focus: "Run", mainWorkout: "5 km easy", scheduledDate: "2026-08-03", status: "planned" });
    const [stored] = await db.select().from(planDays).where(eq(planDays.id, day.id));
    expect(stored).toEqual(day);
  });

  it("still finds nothing for another athlete's day", async () => {
    const day = await seedDay();

    await expect(storage.plans.updatePlanDay(day.id, {}, OTHER)).resolves.toBeUndefined();
  });

  it("still writes an update that carries a value", async () => {
    const day = await seedDay();

    const result = await storage.plans.updatePlanDay(day.id, { focus: "Tempo" }, ATHLETE);

    expect(result?.focus).toBe("Tempo");
  });
});

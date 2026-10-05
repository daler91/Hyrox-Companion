import { type GeneratePlanInput, planDays, trainingPlans } from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateJsonText } from "../ai/providers";
import { db } from "../db";
import { storage } from "../storage";
import { resetIntegrationDb, seedUser } from "../storage/__tests__/integrationDb";
import { createPendingPlan, executePlanGeneration } from "./planGenerationService";

// The model is the only thing stood in for: the plan's rows, its schedule and
// the retirement are the real writes.
vi.mock("../ai/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ai/providers")>()),
  generateJsonText: vi.fn(),
}));

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

/** One generated week: a squat session on Monday, rest the other days. */
function generatedWeek() {
  return WEEKDAYS.map((dayName) =>
    dayName === "Monday"
      ? {
          weekNumber: 1,
          dayName,
          focus: "Strength",
          mainWorkout: "Back squat 2x5 at 100kg",
          accessory: null,
          notes: null,
          exercises: [
            {
              exerciseName: "back_squat",
              category: "strength",
              sets: [{ setNumber: 1, reps: 5, weight: 100 }],
            },
          ],
        }
      : {
          weekNumber: 1,
          dayName,
          focus: "Rest",
          mainWorkout: "Complete rest",
          accessory: null,
          notes: null,
          exercises: [],
        },
  );
}

/**
 * A generation whose last step fails after the plan's days are written — D46
 * (CODEBASE_ANALYSIS_2026-10-03). Scheduling used to commit on its own before
 * the publish, so the plan was marked failed with its days already on the
 * calendar: the plan that started last, so getPlanForDate handed it back as
 * the athlete's plan, while the plan it was meant to replace stayed live.
 */
describe("plan generation's publish (real Postgres)", () => {
  const ATHLETE = "plan-gen-athlete";
  // 2027-01-04 is a Monday, safely after today, so retirement takes effect
  // from the new plan's start.
  const input: GeneratePlanInput = {
    goal: "Hyrox race prep",
    daysPerWeek: 2,
    experienceLevel: "intermediate",
    startDate: "2027-01-04",
    endDate: "2027-01-10",
    endDateIsRaceDate: true,
  };

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ATHLETE);
    vi.mocked(generateJsonText).mockResolvedValue({
      text: JSON.stringify(generatedWeek()),
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  /** The plan the athlete is training, running across the new plan's weeks. */
  async function seedCurrentPlan(overrides: Partial<typeof trainingPlans.$inferInsert> = {}) {
    const [plan] = await db
      .insert(trainingPlans)
      .values({
        userId: ATHLETE,
        name: "Current block",
        totalWeeks: 12,
        startDate: "2026-12-07",
        endDate: "2027-02-28",
        ...overrides,
      })
      .returning();
    await db.insert(planDays).values({
      planId: plan.id,
      weekNumber: 5,
      dayName: "Wednesday",
      focus: "Intervals",
      mainWorkout: "6x800m",
      scheduledDate: "2027-01-06",
    });
    return plan;
  }

  async function readPlan(id: string) {
    const [plan] = await db.select().from(trainingPlans).where(eq(trainingPlans.id, id));
    return plan;
  }

  async function readDays(planId: string) {
    return await db.select().from(planDays).where(eq(planDays.planId, planId));
  }

  it("leaves a plan whose publish failed with nothing on the calendar, and the current plan in place", async () => {
    const current = await seedCurrentPlan();
    const pending = await createPendingPlan(input, ATHLETE);
    vi.spyOn(storage.plans, "updateEngineState").mockRejectedValueOnce(
      new Error("connection terminated"),
    );

    await expect(
      executePlanGeneration(pending.id, { ...input, supersedePlanIds: [current.id] }, ATHLETE),
    ).rejects.toThrow("connection terminated");

    expect(await readPlan(pending.id)).toMatchObject({
      generationStatus: "failed",
      startDate: null,
      endDate: null,
    });
    expect(await readDays(pending.id)).toEqual([]);
    expect((await readPlan(current.id)).retiredOn).toBeNull();
    expect((await storage.plans.getPlanForDate(ATHLETE, "2027-01-06"))?.id).toBe(current.id);
  });

  it("dates, publishes and hands over to a plan whose publish succeeds", async () => {
    const current = await seedCurrentPlan();
    const pending = await createPendingPlan(input, ATHLETE);

    await executePlanGeneration(pending.id, { ...input, supersedePlanIds: [current.id] }, ATHLETE);

    expect(await readPlan(pending.id)).toMatchObject({
      generationStatus: "ready",
      startDate: "2027-01-04",
      endDate: "2027-01-10",
    });
    const dates = (await readDays(pending.id)).map((day) => day.scheduledDate).sort();
    expect(dates).toEqual([
      "2027-01-04",
      "2027-01-05",
      "2027-01-06",
      "2027-01-07",
      "2027-01-08",
      "2027-01-09",
      "2027-01-10",
    ]);
    expect((await readPlan(current.id)).retiredOn).toBe("2027-01-04");
    expect((await storage.plans.getPlanForDate(ATHLETE, "2027-01-06"))?.id).toBe(pending.id);
    expect((await storage.plans.getPlanForDate(ATHLETE, "2027-01-01"))?.id).toBe(current.id);
  });

  it("never answers with a failed plan already stored with dates", async () => {
    const current = await seedCurrentPlan();
    // As the old failure path left it: dated, failed, and started last.
    const failed = await seedCurrentPlan({
      name: "AI Plan: Hyrox race prep",
      startDate: "2027-01-04",
      endDate: "2027-01-10",
      generationStatus: "failed",
    });

    expect((await storage.plans.getPlanForDate(ATHLETE, "2027-01-06"))?.id).toBe(current.id);

    // Published, the same plan wins the overlap: its status alone keeps it out.
    await db
      .update(trainingPlans)
      .set({ generationStatus: "ready" })
      .where(eq(trainingPlans.id, failed.id));
    expect((await storage.plans.getPlanForDate(ATHLETE, "2027-01-06"))?.id).toBe(failed.id);
  });
});

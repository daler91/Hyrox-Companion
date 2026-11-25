import { addDaysToISODate, weekdayName } from "@shared/dateUtils";
import { exerciseSets, planDays, trainingPlans } from "@shared/schema";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import type { TrainingContext } from "../../gemini/index";
import { resetIntegrationDb, seedUser } from "../../storage/__tests__/integrationDb";
import { getLocalDateStrSafe } from "../../timezone";
import { applyPlanAdaptation, computePlanAdaptation } from "../planAdaptationService";

/**
 * The plan following a session that never happened, end to end against the
 * REAL schema: read the plan's days, hold the next session at the missed
 * step, write it — and take it back when the session returns to the plan.
 *
 * The athlete's complaint this answers: miss squats at 100 kg and next week
 * still read 102.5 kg, as if the missed session had been done.
 */
describe("plan adaptation after a missed session (real Postgres)", () => {
  const USER = "missed-adapt-user";
  // The active plan is the one covering the athlete's own today (UTC here).
  const today = getLocalDateStrSafe(new Date(), "UTC");
  const context = { currentDate: today } as unknown as TrainingContext;
  const units = { weightUnit: "kg", distanceUnit: "km" };
  const missedOn = addDaysToISODate(today, -2);
  const nextSession = addDaysToISODate(today, 5);

  async function seedSquatDay(
    planId: string,
    scheduledDate: string,
    weight: number,
    overrides: Partial<typeof planDays.$inferInsert> = {},
  ) {
    const [day] = await db
      .insert(planDays)
      .values({
        planId,
        // Week 2 of 8: a loading week, not the plan's deload.
        weekNumber: 2,
        dayName: "Monday",
        focus: "Lower Strength",
        mainWorkout: `A) Back Squat 3x5 @ ${weight} kg (RPE 8)`,
        status: "planned",
        scheduledDate,
        ...overrides,
      })
      .returning();
    await db.insert(exerciseSets).values(
      [1, 2, 3].map((setNumber) => ({
        planDayId: day.id,
        exerciseName: "back_squat",
        category: "strength",
        setNumber,
        reps: 5,
        weight,
        weightUnit: "kg",
        sortOrder: setNumber,
      })),
    );
    return day;
  }

  async function seedPlan() {
    const [plan] = await db
      .insert(trainingPlans)
      .values({
        userId: USER,
        name: "Block",
        totalWeeks: 8,
        startDate: addDaysToISODate(today, -10),
        endDate: addDaysToISODate(today, 45),
      })
      .returning();
    const missed = await seedSquatDay(plan.id, missedOn, 100, { status: "missed" });
    const next = await seedSquatDay(plan.id, nextSession, 102.5);
    return { plan, missed, next };
  }

  async function runPass(): Promise<number> {
    const adaptation = await computePlanAdaptation(USER, context, units, new Set());
    return db.transaction((tx) => applyPlanAdaptation(adaptation, USER, tx));
  }

  async function storedWeights(planDayId: string): Promise<(number | null)[]> {
    const rows = await db
      .select({ weight: exerciseSets.weight })
      .from(exerciseSets)
      .where(eq(exerciseSets.planDayId, planDayId))
      .orderBy(asc(exerciseSets.sortOrder));
    return rows.map((row) => row.weight);
  }

  async function storedDay(planDayId: string) {
    const [day] = await db.select().from(planDays).where(eq(planDays.id, planDayId));
    return day;
  }

  async function engineState(planId: string) {
    const [plan] = await db.select().from(trainingPlans).where(eq(trainingPlans.id, planId));
    return plan?.engineState ?? null;
  }

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(USER);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("holds the next session at the missed load and says why on its card", async () => {
    const { plan, missed, next } = await seedPlan();

    expect(await runPass()).toBe(1);

    expect(await storedWeights(next.id)).toEqual([100, 100, 100]);
    const day = await storedDay(next.id);
    expect(day?.mainWorkout).toBe("A) Back Squat 3x5 @ 100 kg (RPE 8)");
    expect(day?.aiSource).toBe("progression");
    expect(day?.aiRationale).toBe(
      `Auto-progression: You missed ${weekdayName(missedOn)}'s Back Squat (3x5 @ 100 kg), so it picks up from that load rather than jumping ahead.`,
    );
    expect(day?.aiInputsUsed?.progressionChanges).toEqual([
      { exercise: "back_squat", kind: "hold", from: 102.5, to: 100, unit: "kg" },
    ]);
    // The missed session itself is untouched.
    expect(await storedWeights(missed.id)).toEqual([100, 100, 100]);

    const state = await engineState(plan.id);
    expect(state?.adaptedMisses).toEqual([`${missed.id}|${missedOn}`]);
    expect(state?.missHolds).toHaveLength(1);
    expect(state?.missHolds?.[0]).toMatchObject({
      planDayId: missed.id,
      missedOn,
      exercise: "back_squat",
      unit: "kg",
    });
  });

  it("counts the miss once: a second pass changes nothing", async () => {
    const { next } = await seedPlan();
    await runPass();

    expect(await runPass()).toBe(0);
    expect(await storedWeights(next.id)).toEqual([100, 100, 100]);
  });

  it("gives the load back when the missed session is folded into a day still ahead", async () => {
    const { plan, missed, next } = await seedPlan();
    await runPass();

    // What a fold writes (services/missedRecovery): back to planned, on a new day.
    await db
      .update(planDays)
      .set({
        status: "planned",
        scheduledDate: addDaysToISODate(today, 1),
        recovery: "folded",
        missedOn,
      })
      .where(eq(planDays.id, missed.id));

    expect(await runPass()).toBe(1);

    expect(await storedWeights(next.id)).toEqual([102.5, 102.5, 102.5]);
    const day = await storedDay(next.id);
    expect(day?.mainWorkout).toBe("A) Back Squat 3x5 @ 102.5 kg (RPE 8)");
    expect(day?.aiRationale).toContain("is no longer missed, so Back Squat returns to its planned load");
    const state = await engineState(plan.id);
    expect(state?.missHolds).toEqual([]);
    expect(state?.adaptedMisses).toEqual([]);
  });

  it("leaves a load the athlete edited alone when the session comes back", async () => {
    const { missed, next } = await seedPlan();
    await runPass();
    await db.update(exerciseSets).set({ weight: 95 }).where(eq(exerciseSets.planDayId, next.id));
    await db
      .update(planDays)
      .set({ status: "planned", scheduledDate: addDaysToISODate(today, 1) })
      .where(eq(planDays.id, missed.id));

    expect(await runPass()).toBe(0);
    expect(await storedWeights(next.id)).toEqual([95, 95, 95]);
  });

  it("holds for a skipped session too, and not for an optional one", async () => {
    const { missed, next } = await seedPlan();
    await db
      .update(planDays)
      .set({ status: "skipped", priority: "optional" })
      .where(eq(planDays.id, missed.id));
    expect(await runPass()).toBe(0);
    expect(await storedWeights(next.id)).toEqual([102.5, 102.5, 102.5]);

    await db.update(planDays).set({ priority: null }).where(eq(planDays.id, missed.id));
    expect(await runPass()).toBe(1);
    expect(await storedWeights(next.id)).toEqual([100, 100, 100]);
    expect((await storedDay(next.id))?.aiRationale).toContain("You skipped");
  });
});

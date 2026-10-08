import { exerciseSets, planDays, trainingPlans } from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { resetIntegrationDb, seedExerciseSet, seedUser } from "../../storage/__tests__/integrationDb";
import { createWorkoutAndScheduleCoaching } from "./workouts";

/**
 * A14 (CODEBASE_ANALYSIS_2026-10-03), against real Postgres: create-path plan
 * linking (resolveActivePlanLinks / applyResolvedPlanLinks) is the only check
 * in front of the prescription copy, which reads by planDayId alone. Route
 * tests mock the use case and the other integration suites post plan-less
 * workouts, so a refactor that fell back to the client's planDayId would have
 * copied another athlete's prescribed sets into the caller's log with every
 * test green.
 */
describe("createWorkoutAndScheduleCoaching plan linking (real Postgres)", () => {
  const ALICE = "plan-link-alice";
  const BOB = "plan-link-bob";

  async function seedPlanWithDay(userId: string, scheduledDate: string) {
    const [plan] = await db
      .insert(trainingPlans)
      .values({ userId, name: "Block", totalWeeks: 2, startDate: "2026-06-01", endDate: "2026-06-14" })
      .returning();
    const [day] = await db
      .insert(planDays)
      .values({
        planId: plan.id,
        weekNumber: 1,
        dayName: "Wednesday",
        focus: "Strength",
        mainWorkout: "5x5 Back Squat",
        scheduledDate,
        status: "planned",
      })
      .returning();
    await seedExerciseSet({
      planDayId: day.id,
      exerciseName: "back_squat",
      category: "strength",
      setNumber: 1,
      reps: 5,
      weight: 100,
    });
    return { plan, day };
  }

  function setsOf(workoutLogId: string) {
    return db
      .select({ exerciseName: exerciseSets.exerciseName })
      .from(exerciseSets)
      .where(eq(exerciseSets.workoutLogId, workoutLogId));
  }

  async function statusOf(planDayId: string) {
    const [day] = await db.select({ status: planDays.status }).from(planDays).where(eq(planDays.id, planDayId));
    return day?.status;
  }

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE);
    await seedUser(BOB);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("drops another athlete's plan day and copies none of its prescription", async () => {
    const bobs = await seedPlanWithDay(BOB, "2026-06-03");

    const log = await createWorkoutAndScheduleCoaching(
      {
        date: "2026-06-03",
        focus: "Strength",
        mainWorkout: "Squats",
        planDayId: bobs.day.id,
        planId: bobs.plan.id,
      },
      undefined,
      ALICE,
    );

    expect(log).toEqual(expect.objectContaining({ userId: ALICE, planDayId: null, planId: null }));
    expect(await setsOf(log.id)).toEqual([]);
    expect(await statusOf(bobs.day.id)).toBe("planned");
  });

  it("links the caller's own plan day, copies its prescription and completes it", async () => {
    const own = await seedPlanWithDay(ALICE, "2026-06-03");

    const log = await createWorkoutAndScheduleCoaching(
      { date: "2026-06-03", focus: "Strength", mainWorkout: "5x5 Back Squat", planDayId: own.day.id },
      undefined,
      ALICE,
    );

    expect(log).toEqual(expect.objectContaining({ planDayId: own.day.id, planId: own.plan.id }));
    expect(await setsOf(log.id)).toEqual([{ exerciseName: "back_squat" }]);
    expect(await statusOf(own.day.id)).toBe("completed");
  });

  it("matches a standalone log to the caller's planned day on that date", async () => {
    const own = await seedPlanWithDay(ALICE, "2026-06-03");

    const log = await createWorkoutAndScheduleCoaching(
      { date: "2026-06-03", focus: "Strength", mainWorkout: "Squats" },
      undefined,
      ALICE,
    );

    expect(log).toEqual(expect.objectContaining({ planDayId: own.day.id, planId: own.plan.id }));
  });

  it("ignores a client planId when no plan of the caller's covers the date", async () => {
    const bobs = await seedPlanWithDay(BOB, "2026-06-03");
    await seedPlanWithDay(ALICE, "2026-06-03");

    const log = await createWorkoutAndScheduleCoaching(
      { date: "2026-07-20", focus: "Run", mainWorkout: "Easy 5 km", planId: bobs.plan.id },
      undefined,
      ALICE,
    );

    expect(log).toEqual(expect.objectContaining({ planDayId: null, planId: null }));
  });
});

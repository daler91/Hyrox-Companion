import {
  exerciseSets,
  planDays,
  type StravaActivitySummary,
  trainingPlans,
  workoutLogs,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../db";
import { resetIntegrationDb, seedExerciseSet, seedUser } from "../storage/__tests__/integrationDb";
import { createLogFromPlanDayWithStravaInTx, pickDeviceMetrics } from "./deviceActivityLink";
import { mapStravaActivityToWorkout } from "./stravaMapper";

/**
 * D12 (CODEBASE_ANALYSIS_2026-10-03) against the real schema: a recording the
 * sync links to an open plan day on its own lands as what the watch measured,
 * never as the prescription, and the day is completed — a missed one too.
 */
describe("auto-linking a recording to a plan day (real Postgres)", () => {
  const ATHLETE = "auto-link-athlete";

  const SHORT_RUN: StravaActivitySummary = {
    id: 777001,
    name: "Morning Run",
    type: "Run",
    sport_type: "Run",
    start_date: "2026-06-01T05:30:00Z",
    start_date_local: "2026-06-01T06:30:00Z",
    distance: 6100,
    moving_time: 30 * 60,
    elapsed_time: 31 * 60,
    total_elevation_gain: 20,
    average_speed: 3.4,
    max_speed: 4.1,
  };

  type Prescription = {
    exerciseName: string;
    category: string;
    distance?: number;
    reps?: number;
    weight?: number;
  };

  async function seedDay(status: "planned" | "missed", prescription: Prescription) {
    const [plan] = await db
      .insert(trainingPlans)
      .values({
        userId: ATHLETE,
        name: "Build",
        totalWeeks: 4,
        startDate: "2026-06-01",
        endDate: "2026-06-28",
      })
      .returning();
    const [day] = await db
      .insert(planDays)
      .values({
        planId: plan.id,
        weekNumber: 1,
        dayName: "monday",
        focus: "Tempo run",
        mainWorkout: "8 km tempo",
        scheduledDate: "2026-06-01",
        status,
      })
      .returning();
    await seedExerciseSet({ planDayId: day.id, setNumber: 1, ...prescription });
    return day;
  }

  function autoLink(day: typeof planDays.$inferSelect, raw: StravaActivitySummary) {
    return db.transaction((tx) =>
      createLogFromPlanDayWithStravaInTx(tx, {
        userId: ATHLETE,
        planDay: day,
        raw,
        metrics: pickDeviceMetrics(mapStravaActivityToWorkout(raw, ATHLETE, "km")),
        linkSource: "auto",
        confidence: 0.8,
      }),
    );
  }

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ATHLETE);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("records the 6.1 km run, not the 8 km prescribed, with no compliance, and completes a missed day", async () => {
    const day = await seedDay("missed", {
      exerciseName: "run",
      category: "running",
      distance: 8000,
    });

    const log = await autoLink(day, SHORT_RUN);

    const [stored] = await db.select().from(workoutLogs).where(eq(workoutLogs.id, log.id));
    expect(stored).toMatchObject({
      planDayId: day.id,
      deviceLinkSource: "auto",
      distanceMeters: 6100,
    });
    expect(stored.compliancePct).toBeNull();
    const sets = await db.select().from(exerciseSets).where(eq(exerciseSets.workoutLogId, log.id));
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({
      exerciseName: "run",
      distance: 6100,
      plannedDistance: null,
      reps: null,
    });
    const [dayAfter] = await db.select().from(planDays).where(eq(planDays.id, day.id));
    expect(dayAfter.status).toBe("completed");
  });

  it("writes no lift from a 'Weight Training' recording on a strength day", async () => {
    const day = await seedDay("planned", {
      exerciseName: "back_squat",
      category: "strength",
      reps: 5,
      weight: 110,
    });

    const log = await autoLink(day, {
      ...SHORT_RUN,
      id: 777002,
      type: "WeightTraining",
      sport_type: "WeightTraining",
      distance: 0,
    });

    expect(
      await db.select().from(exerciseSets).where(eq(exerciseSets.workoutLogId, log.id)),
    ).toEqual([]);
    const [dayAfter] = await db.select().from(planDays).where(eq(planDays.id, day.id));
    expect(dayAfter.status).toBe("completed");
  });
});

import {
  exerciseSets,
  planDays,
  type StravaActivitySummary,
  trainingPlans,
  users,
  workoutLogs,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../db";
import { seedUser, seedWorkoutLog } from "../storage/__tests__/integrationDb";
import {
  attachStravaActivityToLogInTx,
  createLogFromPlanDayWithStravaInTx,
  pickDeviceMetrics,
  unlinkDeviceActivity,
} from "./deviceActivityLink";
import { mapStravaActivityToWorkout } from "./stravaMapper";
import { updateWorkout } from "./workoutService";

/**
 * D40 (CODEBASE_ANALYSIS_2026-10-03), against the real schema: unlink nulled
 * every column the link had filled, even one the athlete changed since. An
 * RPE they moved from Strava's 6 to 8 left their log and went to the released
 * recording's row. A filled column now goes back to NULL only while it still
 * holds what the recording supplied, read back from the jsonb snapshot and
 * compared at the precision each column stores.
 *
 * Cleans up only its own athlete rather than resetting the whole database.
 */

const ATHLETE = "changed-fill-athlete";
const DAY_DATE = "2026-06-04";

const RATED_RUN: StravaActivitySummary = {
  id: 784001,
  name: "Lunch Run",
  type: "Run",
  sport_type: "Run",
  start_date: `${DAY_DATE}T11:30:00Z`,
  start_date_local: `${DAY_DATE}T12:30:00Z`,
  distance: 8123,
  moving_time: 41 * 60 + 17,
  elapsed_time: 42 * 60,
  total_elevation_gain: 23.7,
  average_speed: 3.281,
  max_speed: 4.37,
  average_heartrate: 151.6,
  max_heartrate: 172,
  average_cadence: 86.4,
};

/** The recording's metrics, with the RPE 6 the athlete gave it on Strava. */
const METRICS = {
  ...pickDeviceMetrics(mapStravaActivityToWorkout(RATED_RUN, ATHLETE, "km")),
  rpe: 6,
};

async function removeAthlete(): Promise<void> {
  const logs = await db
    .select({ id: workoutLogs.id })
    .from(workoutLogs)
    .where(eq(workoutLogs.userId, ATHLETE));
  if (logs.length > 0) {
    await db.delete(exerciseSets).where(
      inArray(
        exerciseSets.workoutLogId,
        logs.map((log) => log.id),
      ),
    );
    await db.delete(workoutLogs).where(eq(workoutLogs.userId, ATHLETE));
  }
  const plans = await db
    .select({ id: trainingPlans.id })
    .from(trainingPlans)
    .where(eq(trainingPlans.userId, ATHLETE));
  if (plans.length > 0) {
    const planIds = plans.map((plan) => plan.id);
    await db.delete(planDays).where(inArray(planDays.planId, planIds));
    await db.delete(trainingPlans).where(eq(trainingPlans.userId, ATHLETE));
  }
  await db.delete(users).where(eq(users.id, ATHLETE));
}

/** The athlete's own log for the day, with the recording attached by the sync. */
async function ownLogWithRecording() {
  const own = await seedWorkoutLog(ATHLETE, DAY_DATE, {
    focus: "Easy run",
    mainWorkout: "Easy 8 km",
  });
  const attached = await db.transaction((tx) =>
    attachStravaActivityToLogInTx(tx, {
      logId: own.id,
      userId: ATHLETE,
      raw: RATED_RUN,
      metrics: METRICS,
      linkSource: "auto",
      confidence: 0.9,
    }),
  );
  if (!attached) throw new Error("The recording did not attach.");
  return attached;
}

function unlink(logId: string) {
  return unlinkDeviceActivity({ userId: ATHLETE, logId, distanceUnit: "km" });
}

beforeEach(async () => {
  await removeAthlete();
  await seedUser(ATHLETE);
});

afterAll(async () => {
  await removeAthlete();
});

describe("unlinking a recording from a log the athlete edited (D40)", () => {
  it("returns every filled column the athlete left alone, the rating with the recording", async () => {
    const log = await ownLogWithRecording();

    const { log: kept, standalone } = await unlink(log.id);

    expect(kept).toMatchObject({
      rpe: null,
      duration: null,
      distanceMeters: null,
      avgSpeed: null,
      avgCadence: null,
      avgHeartrate: null,
      startedAt: null,
      stravaActivityId: null,
    });
    expect(standalone).toMatchObject({
      rpe: 6,
      duration: 41,
      stravaActivityId: String(RATED_RUN.id),
    });
  });

  it("keeps the RPE and duration the athlete changed on their log, and the recording gets its own", async () => {
    const log = await ownLogWithRecording();
    await updateWorkout(log.id, { rpe: 8, duration: 45 }, undefined, ATHLETE);

    const { log: kept, standalone } = await unlink(log.id);

    expect(kept).toMatchObject({
      rpe: 8,
      duration: 45,
      distanceMeters: null,
      avgSpeed: null,
      startedAt: null,
      stravaActivityId: null,
    });
    expect(standalone).toMatchObject({ rpe: 6, duration: 41 });
  });

  it("keeps a plan-day log the link created once the athlete changed the RPE it filled", async () => {
    const [plan] = await db
      .insert(trainingPlans)
      .values({
        userId: ATHLETE,
        name: "Build",
        totalWeeks: 4,
        startDate: DAY_DATE,
        endDate: "2026-07-01",
      })
      .returning();
    const [day] = await db
      .insert(planDays)
      .values({
        planId: plan.id,
        weekNumber: 1,
        dayName: "thursday",
        focus: "Easy run",
        mainWorkout: "Easy 8 km",
        scheduledDate: DAY_DATE,
        status: "planned",
      })
      .returning();
    const created = await db.transaction((tx) =>
      createLogFromPlanDayWithStravaInTx(tx, {
        userId: ATHLETE,
        planDay: day,
        raw: RATED_RUN,
        metrics: METRICS,
        linkSource: "auto",
        confidence: 0.9,
      }),
    );
    await updateWorkout(created.id, { rpe: 8 }, undefined, ATHLETE);

    const { log: kept, standalone } = await unlink(created.id);

    expect(kept).toMatchObject({ id: created.id, source: "manual", rpe: 8, planDayId: day.id });
    expect(standalone.rpe).toBe(6);
  });
});

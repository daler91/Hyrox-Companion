import {
  exerciseSets,
  planDays,
  type StravaActivitySummary,
  trainingPlans,
  users,
  workoutLogs,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db, pool } from "../../db";
import { createWorkoutRouteSchema } from "../../routes/workouts/shared";
import { seedExerciseSet, seedUser } from "../../storage/__tests__/integrationDb";
import { createLogFromPlanDayWithStravaInTx, pickDeviceMetrics } from "../deviceActivityLink";
import { mapStravaActivityToWorkout } from "../stravaMapper";
import { createWorkout } from "../workoutUseCases";
import { createWorkoutInTx, updateWorkout } from "./workouts";

/**
 * Against the real schema:
 *
 *  - D48 (CODEBASE_ANALYSIS_2026-10-03): "Done" on a plan day inserted a log
 *    without looking for one already there, and locked the day only after
 *    the insert. A confirm racing or following a Strava reconcile of the
 *    day, or a second tap from a stale timeline, wrote a second log with a
 *    second copy of the prescribed sets.
 *  - D49: the create and update transactions read the athlete's units
 *    through the pool while holding a connection of their own.
 *
 * Cleans up only its own athlete rather than resetting the whole database.
 */

const ATHLETE = "create-in-tx-athlete";
const DAY_DATE = "2026-06-01";

const RUN: StravaActivitySummary = {
  id: 782001,
  name: "Morning Run",
  type: "Run",
  sport_type: "Run",
  start_date: `${DAY_DATE}T05:30:00Z`,
  start_date_local: `${DAY_DATE}T06:30:00Z`,
  distance: 8050,
  moving_time: 40 * 60,
  elapsed_time: 41 * 60,
  total_elevation_gain: 20,
  average_speed: 3.35,
  max_speed: 4.1,
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
    const days = await db
      .select({ id: planDays.id })
      .from(planDays)
      .where(inArray(planDays.planId, planIds));
    if (days.length > 0) {
      await db.delete(exerciseSets).where(
        inArray(
          exerciseSets.planDayId,
          days.map((day) => day.id),
        ),
      );
    }
    await db.delete(planDays).where(inArray(planDays.planId, planIds));
    await db.delete(trainingPlans).where(eq(trainingPlans.userId, ATHLETE));
  }
  await db.delete(users).where(eq(users.id, ATHLETE));
}

/** A planned 8 km run day, with its prescribed run. */
async function seedRunDay() {
  const [plan] = await db
    .insert(trainingPlans)
    .values({
      userId: ATHLETE,
      name: "Build",
      totalWeeks: 4,
      startDate: DAY_DATE,
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
      scheduledDate: DAY_DATE,
      status: "planned",
    })
    .returning();
  await seedExerciseSet({
    planDayId: day.id,
    exerciseName: "run",
    category: "running",
    setNumber: 1,
    distance: 8000,
    distanceUnit: "m",
    sortOrder: 0,
  });
  return day;
}

/** What the timeline's "Done" posts for the day (useWorkoutActions), as the route parses it. */
function donePayload(day: typeof planDays.$inferSelect) {
  return createWorkoutRouteSchema.parse({
    planDayId: day.id,
    date: DAY_DATE,
    focus: day.focus,
    mainWorkout: day.mainWorkout,
  });
}

function autoLinkRun(day: typeof planDays.$inferSelect) {
  return db.transaction((tx) =>
    createLogFromPlanDayWithStravaInTx(tx, {
      userId: ATHLETE,
      planDay: day,
      raw: RUN,
      metrics: pickDeviceMetrics(mapStravaActivityToWorkout(RUN, ATHLETE, "km")),
      linkSource: "auto",
      confidence: 0.9,
    }),
  );
}

async function logsOnDay(dayId: string) {
  return await db.select().from(workoutLogs).where(eq(workoutLogs.planDayId, dayId));
}

beforeEach(async () => {
  await removeAthlete();
  await seedUser(ATHLETE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await removeAthlete();
});

describe("Done on a plan day that already has its log (D48)", () => {
  it("answers with the log a Strava reconcile wrote instead of writing a second", async () => {
    const day = await seedRunDay();
    const reconciled = await autoLinkRun(day);

    const confirmed = await createWorkout({ userId: ATHLETE, payload: donePayload(day) });

    expect(confirmed.id).toBe(reconciled.id);
    const logs = await logsOnDay(day.id);
    expect(logs.map((log) => log.id)).toEqual([reconciled.id]);
    // The prescription was not copied in beside the recording's run.
    const sets = await db
      .select()
      .from(exerciseSets)
      .where(eq(exerciseSets.workoutLogId, reconciled.id));
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ exerciseName: "run", distance: 8050, plannedDistance: null });
    const [after] = await db.select().from(planDays).where(eq(planDays.id, day.id));
    expect(after.status).toBe("completed");
  });

  it("writes one log when two confirms of the day overlap", async () => {
    const day = await seedRunDay();

    const [first, second] = await Promise.all([
      createWorkout({ userId: ATHLETE, payload: donePayload(day) }),
      createWorkout({ userId: ATHLETE, payload: donePayload(day) }),
    ]);

    expect(first.id).toBe(second.id);
    const logs = await logsOnDay(day.id);
    expect(logs).toHaveLength(1);
    const sets = await db
      .select()
      .from(exerciseSets)
      .where(eq(exerciseSets.workoutLogId, first.id));
    expect(sets).toHaveLength(1);
  });

  it("inserts a create that carries the athlete's own sets as a second log of the day", async () => {
    // The plan-day picker offers a day that already has a log, labelled
    // "(logged)", so the athlete can add a session to it on purpose. Their
    // sets copy no prescription, so there is nothing to double.
    const day = await seedRunDay();
    const reconciled = await autoLinkRun(day);
    const payload = createWorkoutRouteSchema.parse({
      planDayId: day.id,
      date: DAY_DATE,
      focus: "Tempo run",
      mainWorkout: "8 km tempo",
      rpe: 7,
      exercises: [
        { exerciseName: "run", category: "running", sets: [{ setNumber: 1, distance: 7500 }] },
      ],
    });

    const created = await createWorkout({ userId: ATHLETE, payload });

    expect(created.id).not.toBe(reconciled.id);
    const logs = await logsOnDay(day.id);
    expect(logs.map((log) => log.id).sort()).toEqual([reconciled.id, created.id].sort());
    const sets = await db
      .select()
      .from(exerciseSets)
      .where(eq(exerciseSets.workoutLogId, created.id));
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ exerciseName: "run", distance: 7500, plannedDistance: null });
  });

  it("answers a plain Done with the newest of several logs on the day", async () => {
    const day = await seedRunDay();
    await db.insert(workoutLogs).values({
      userId: ATHLETE,
      planDayId: day.id,
      date: "2026-05-31",
      focus: "Tempo run",
      mainWorkout: "8 km tempo",
    });
    const reconciled = await autoLinkRun(day);

    const confirmed = await createWorkout({ userId: ATHLETE, payload: donePayload(day) });

    expect(confirmed.id).toBe(reconciled.id);
    expect(await logsOnDay(day.id)).toHaveLength(2);
  });

  it("refuses a create that carries a rating or text of the athlete's", async () => {
    const day = await seedRunDay();
    await autoLinkRun(day);

    await expect(
      createWorkout({ userId: ATHLETE, payload: { ...donePayload(day), rpe: 7 } }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      createWorkout({ userId: ATHLETE, payload: { ...donePayload(day), notes: "Legs heavy" } }),
    ).rejects.toMatchObject({ status: 409 });

    expect(await logsOnDay(day.id)).toHaveLength(1);
  });

  it("still creates the day's log, with the prescription copied in, when it has none", async () => {
    const day = await seedRunDay();

    const created = await createWorkout({ userId: ATHLETE, payload: donePayload(day) });

    expect(created.planDayId).toBe(day.id);
    const sets = await db
      .select()
      .from(exerciseSets)
      .where(eq(exerciseSets.workoutLogId, created.id));
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ exerciseName: "run", distance: 8000, plannedDistance: 8000 });
  });
});

describe("unit preferences inside the write transactions (D49)", () => {
  const SQUAT = {
    exerciseName: "back_squat",
    category: "strength",
    sets: [{ setNumber: 1, reps: 5, weight: 225 }],
  };

  it("reads the athlete's units on the transaction's own connection", async () => {
    // The switch to lbs is visible only inside this transaction: a read
    // through the pool sees the committed kg.
    const created = await db.transaction(async (tx) => {
      await tx.update(users).set({ weightUnit: "lbs" }).where(eq(users.id, ATHLETE));
      return await createWorkoutInTx(
        tx,
        { date: DAY_DATE, focus: "Strength", mainWorkout: "Back squat 5 @ 225" },
        [SQUAT],
        undefined,
        ATHLETE,
      );
    });

    expect(created.exerciseSets).toHaveLength(1);
    expect(created.exerciseSets?.[0]).toMatchObject({ weight: 225, weightUnit: "lbs" });
  });

  it("makes no read through the pool while an update's transaction is open", async () => {
    const created = await db.transaction((tx) =>
      createWorkoutInTx(
        tx,
        { date: DAY_DATE, focus: "Strength", mainWorkout: "Squat" },
        [SQUAT],
        undefined,
        ATHLETE,
      ),
    );
    const poolQuery = vi.spyOn(pool, "query");

    const updated = await updateWorkout(
      created.id,
      {},
      [{ ...SQUAT, sets: [{ setNumber: 1, reps: 3, weight: 245 }] }],
      ATHLETE,
    );

    expect(updated?.exerciseSets?.[0]).toMatchObject({ reps: 3, weight: 245, weightUnit: "kg" });
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("makes no read through the pool while an auto link writes the recording's set", async () => {
    const day = await seedRunDay();
    const poolQuery = vi.spyOn(pool, "query");

    const log = await autoLinkRun(day);

    expect(poolQuery).not.toHaveBeenCalled();
    const sets = await db.select().from(exerciseSets).where(eq(exerciseSets.workoutLogId, log.id));
    expect(sets).toHaveLength(1);
  });
});

import {
  exerciseSets,
  planDays,
  type StravaActivitySummary,
  trainingPlans,
  users,
  workoutLogs,
} from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../db";
import { storage } from "../storage";
import { seedExerciseSet, seedUser } from "../storage/__tests__/integrationDb";
import {
  createLogFromPlanDayWithStravaInTx,
  pickDeviceMetrics,
  unlinkDeviceActivity,
} from "./deviceActivityLink";
import { updatePlanDayStatus } from "./planService";
import { mapStravaActivityToWorkout } from "./stravaMapper";

/**
 * D12 (CODEBASE_ANALYSIS_2026-10-03) follow-ups against the real schema. An
 * auto link writes one set synthesised from the recording and none of the
 * prescription. When the recording later leaves the log, that set goes with
 * it (the release writes it again on the recording's own row), and the day's
 * prescription is never replaced by it or wiped:
 *
 *  - unlinking an auto-linked log the athlete has since edited keeps the log
 *    but not the recording's set, so the run is not counted twice;
 *  - "Reopen workout" on an auto-linked day keeps the day's prescribed sets,
 *    and appends after them any set the athlete added to the log. A set that
 *    is their version of a prescribed exercise (lifts they typed, the station
 *    they logged on a mixed day, the recording's set they corrected) replaces
 *    that exercise only, once; a pre-D12 copy of the prescription replaces it
 *    all, once. A run they typed (strides filed as "run", a cool-down after
 *    a "Workout" recording, a run typed in place of the recording's set) is
 *    an addition, not their version of the prescribed run, whatever the
 *    recording was; only the recording's set they corrected is that;
 *  - the recording's set is told apart from a run the athlete typed in its
 *    place by its distance and moving time, so theirs is neither removed on
 *    unlink nor dropped on reopen.
 *
 * Cleans up only its own athlete rather than resetting the whole database.
 */
describe("the recording's set leaves with the recording (real Postgres)", () => {
  const ATHLETE = "recording-set-athlete";

  const SHORT_RUN: StravaActivitySummary = {
    id: 778001,
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

  const WEIGHT_TRAINING: StravaActivitySummary = {
    ...SHORT_RUN,
    id: 778002,
    type: "WeightTraining",
    sport_type: "WeightTraining",
    distance: 0,
  };

  /** No set: a "Workout" says an hour happened, nothing of what was in it. */
  const WORKOUT: StravaActivitySummary = {
    ...SHORT_RUN,
    id: 778004,
    name: "HYROX sim",
    type: "Workout",
    sport_type: "Workout",
    distance: 0,
  };

  const RIDE: StravaActivitySummary = {
    ...SHORT_RUN,
    id: 778005,
    name: "Brick ride",
    type: "Ride",
    sport_type: "Ride",
    distance: 40000,
    moving_time: 80 * 60,
  };

  const BACK_SQUAT = { exerciseName: "back_squat", category: "strength", reps: 5, weight: 110 };

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
      const days = await db
        .select({ id: planDays.id })
        .from(planDays)
        .where(
          inArray(
            planDays.planId,
            plans.map((plan) => plan.id),
          ),
        );
      if (days.length > 0) {
        await db.delete(exerciseSets).where(
          inArray(
            exerciseSets.planDayId,
            days.map((day) => day.id),
          ),
        );
      }
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

  type Prescription = {
    exerciseName: string;
    category: string;
    distance?: number;
    reps?: number;
    weight?: number;
  };

  function seedDay(focus: string, prescription: Prescription, sets = 1) {
    return seedSession(
      focus,
      Array.from({ length: sets }, () => prescription),
    );
  }

  /** A plan day prescribing `sets` in this order, each numbered within its exercise. */
  async function seedSession(focus: string, sets: Prescription[]) {
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
        focus,
        mainWorkout: "as prescribed",
        scheduledDate: "2026-06-01",
        status: "planned",
      })
      .returning();
    for (const [sortOrder, set] of sets.entries()) {
      const setNumber = sets
        .slice(0, sortOrder + 1)
        .filter((other) => other.exerciseName === set.exerciseName).length;
      await seedExerciseSet({ planDayId: day.id, setNumber, sortOrder, ...set });
    }
    return day;
  }

  function autoLink(
    day: typeof planDays.$inferSelect,
    raw: StravaActivitySummary,
    linkSource: "auto" | "manual" = "auto",
  ) {
    return db.transaction((tx) =>
      createLogFromPlanDayWithStravaInTx(tx, {
        userId: ATHLETE,
        planDay: day,
        raw,
        metrics: pickDeviceMetrics(mapStravaActivityToWorkout(raw, ATHLETE, "km")),
        linkSource,
        confidence: 0.8,
      }),
    );
  }

  async function daySets(dayId: string) {
    return await db
      .select({
        exerciseName: exerciseSets.exerciseName,
        distance: exerciseSets.distance,
        reps: exerciseSets.reps,
        weight: exerciseSets.weight,
        sortOrder: exerciseSets.sortOrder,
      })
      .from(exerciseSets)
      .where(eq(exerciseSets.planDayId, dayId))
      .orderBy(exerciseSets.sortOrder);
  }

  async function athleteRunSets() {
    return await db
      .select({ workoutLogId: exerciseSets.workoutLogId, distance: exerciseSets.distance })
      .from(exerciseSets)
      .innerJoin(workoutLogs, eq(workoutLogs.id, exerciseSets.workoutLogId))
      .where(and(eq(workoutLogs.userId, ATHLETE), eq(exerciseSets.exerciseName, "run")));
  }

  beforeEach(async () => {
    await removeAthlete();
    await seedUser(ATHLETE);
  });

  afterAll(async () => {
    await removeAthlete();
  });

  it("unlinking an edited auto-linked log keeps the log and counts the run once", async () => {
    const day = await seedDay("Tempo run", {
      exerciseName: "run",
      category: "running",
      distance: 8000,
    });
    const log = await autoLink(day, SHORT_RUN);
    // The athlete rated the session and added the strides they did after it.
    await db.update(workoutLogs).set({ rpe: 7 }).where(eq(workoutLogs.id, log.id));
    await seedExerciseSet({
      workoutLogId: log.id,
      exerciseName: "strides",
      category: "running",
      setNumber: 1,
      reps: 6,
      sortOrder: 1,
    });

    const result = await unlinkDeviceActivity({
      userId: ATHLETE,
      logId: log.id,
      distanceUnit: "km",
    });

    expect(result.log).toMatchObject({ id: log.id, source: "manual", rpe: 7 });
    const kept = await db
      .select({ exerciseName: exerciseSets.exerciseName })
      .from(exerciseSets)
      .where(eq(exerciseSets.workoutLogId, log.id));
    expect(kept.map((set) => set.exerciseName)).toEqual(["strides"]);
    expect(await athleteRunSets()).toEqual([
      { workoutLogId: result.standalone.id, distance: 6100 },
    ]);
  });

  it("reopening an auto-linked run day keeps the 8 km prescription, not the watch's 6.1 km", async () => {
    const day = await seedDay("Tempo run", {
      exerciseName: "run",
      category: "running",
      distance: 8000,
    });
    await autoLink(day, SHORT_RUN);

    await updatePlanDayStatus(day.id, { status: "planned" }, ATHLETE);

    const prescribed = await db
      .select({ exerciseName: exerciseSets.exerciseName, distance: exerciseSets.distance })
      .from(exerciseSets)
      .where(eq(exerciseSets.planDayId, day.id));
    expect(prescribed).toEqual([{ exerciseName: "run", distance: 8000 }]);
    const runs = await athleteRunSets();
    expect(runs.map((set) => set.distance)).toEqual([6100]);
  });

  it("reopening an auto-linked run day the athlete added strides to keeps the 8 km and appends the strides", async () => {
    const day = await seedDay("Tempo run", {
      exerciseName: "run",
      category: "running",
      distance: 8000,
    });
    const log = await autoLink(day, SHORT_RUN);
    await seedExerciseSet({
      workoutLogId: log.id,
      exerciseName: "strides",
      category: "running",
      setNumber: 1,
      reps: 6,
      sortOrder: 1,
    });

    await updatePlanDayStatus(day.id, { status: "planned" }, ATHLETE);

    expect(await daySets(day.id)).toEqual([
      { exerciseName: "run", distance: 8000, reps: null, weight: null, sortOrder: 0 },
      { exerciseName: "strides", distance: null, reps: 6, weight: null, sortOrder: 1 },
    ]);
    // The watch's 6.1 km went with the recording, not onto the day.
    expect((await athleteRunSets()).map((set) => set.distance)).toEqual([6100]);
  });

  it("reopening an auto-linked run day the athlete typed strides on as a run keeps the 8 km and appends them", async () => {
    const day = await seedDay("Tempo run", {
      exerciseName: "run",
      category: "running",
      distance: 8000,
    });
    const log = await autoLink(day, SHORT_RUN);
    // Filed under plain "run", the strides matched the prescribed 8 km by
    // name; the recording's own set is untouched, so the 8 km is what it measured.
    await seedExerciseSet({
      workoutLogId: log.id,
      exerciseName: "run",
      category: "running",
      setNumber: 2,
      reps: 6,
      distance: 100,
      distanceUnit: "m",
      sortOrder: 1,
    });

    await updatePlanDayStatus(day.id, { status: "planned" }, ATHLETE);

    expect(await daySets(day.id)).toEqual([
      { exerciseName: "run", distance: 8000, reps: null, weight: null, sortOrder: 0 },
      { exerciseName: "run", distance: 100, reps: 6, weight: null, sortOrder: 1 },
    ]);
    expect((await athleteRunSets()).map((set) => set.distance)).toEqual([6100]);
  });

  /** Auto-link SHORT_RUN to an 8 km day, then swap the recording's set for the 5 km the athlete says they ran. */
  async function autoLinkWithTypedRun() {
    const day = await seedDay("Tempo run", {
      exerciseName: "run",
      category: "running",
      distance: 8000,
    });
    const log = await autoLink(day, SHORT_RUN);
    await db.delete(exerciseSets).where(eq(exerciseSets.workoutLogId, log.id));
    // Version 1, the recording's exercise, no reps or weight: only the
    // distance and time are not the recording's.
    await seedExerciseSet({
      workoutLogId: log.id,
      exerciseName: "run",
      category: "running",
      setNumber: 1,
      distance: 5000,
      time: 25,
      distanceUnit: "m",
      sortOrder: 0,
    });
    return { day, log };
  }

  it("unlinking keeps a run the athlete typed in place of the recording's set, and the log it is on", async () => {
    const { log } = await autoLinkWithTypedRun();

    const result = await unlinkDeviceActivity({
      userId: ATHLETE,
      logId: log.id,
      distanceUnit: "km",
    });

    expect(result.log).toMatchObject({ id: log.id, source: "manual" });
    const runs = await athleteRunSets();
    expect(runs).toHaveLength(2);
    expect(runs).toEqual(
      expect.arrayContaining([
        { workoutLogId: log.id, distance: 5000 },
        { workoutLogId: result.standalone.id, distance: 6100 },
      ]),
    );
  });

  it("reopening keeps the 8 km and appends a run the athlete typed in place of the recording's set", async () => {
    const { day } = await autoLinkWithTypedRun();

    await updatePlanDayStatus(day.id, { status: "planned" }, ATHLETE);

    // Typed, not corrected: neither of the recording's numbers is left on
    // it, so nothing says it is their version of the 8 km rather than a run
    // they added. Read as their version it deleted the 8 km; read as an
    // addition the day holds both. D12 (CODEBASE_ANALYSIS_2026-10-03)
    expect(await daySets(day.id)).toEqual([
      { exerciseName: "run", distance: 8000, reps: null, weight: null, sortOrder: 0 },
      { exerciseName: "run", distance: 5000, reps: null, weight: null, sortOrder: 1 },
    ]);
    expect((await athleteRunSets()).map((set) => set.distance)).toEqual([6100]);
  });

  it("reopening a HYROX day a 'Workout' recording completed keeps every prescribed run beside the cool-down the athlete added", async () => {
    // A "Workout" recording writes no set, so no recorded run is on the log
    // to tell the athlete's runs by. Matched by name, the one cool-down run
    // deleted all four prescribed 1 km runs.
    const run = { exerciseName: "run", category: "running", distance: 1000 };
    const wallBalls = { exerciseName: "wall_balls", category: "functional", reps: 20 };
    const day = await seedSession("HYROX simulation", [
      run, wallBalls, run, wallBalls, run, wallBalls, run, wallBalls,
    ]);
    const log = await autoLink(day, WORKOUT);
    await seedExerciseSet({
      workoutLogId: log.id,
      ...run,
      distance: 1500,
      setNumber: 1,
      sortOrder: 0,
    });

    await updatePlanDayStatus(day.id, { status: "planned" }, ATHLETE);

    const prescribed = [0, 1, 2, 3].flatMap((station) => [
      { exerciseName: "run", distance: 1000, reps: null, weight: null, sortOrder: station * 2 },
      { exerciseName: "wall_balls", distance: null, reps: 20, weight: null, sortOrder: station * 2 + 1 },
    ]);
    expect(await daySets(day.id)).toEqual([
      ...prescribed,
      { exerciseName: "run", distance: 1500, reps: null, weight: null, sortOrder: 8 },
    ]);
  });

  it("reopening a brick day a Ride recording completed keeps the prescribed run beside the one the athlete added", async () => {
    const day = await seedSession("Brick", [
      { exerciseName: "cycling", category: "conditioning", distance: 40000 },
      { exerciseName: "run", category: "running", distance: 5000 },
    ]);
    const log = await autoLink(day, RIDE);
    await seedExerciseSet({
      workoutLogId: log.id,
      exerciseName: "run",
      category: "running",
      setNumber: 1,
      distance: 2000,
      distanceUnit: "m",
      sortOrder: 1,
    });

    await updatePlanDayStatus(day.id, { status: "planned" }, ATHLETE);

    // The ride's own set went with the recording; the prescription is whole,
    // and the run they added follows it, as it does after unlink.
    expect(await daySets(day.id)).toEqual([
      { exerciseName: "cycling", distance: 40000, reps: null, weight: null, sortOrder: 0 },
      { exerciseName: "run", distance: 5000, reps: null, weight: null, sortOrder: 1 },
      { exerciseName: "run", distance: 2000, reps: null, weight: null, sortOrder: 2 },
    ]);
  });

  it("still takes the recording's own set off an edited log when its moving time is not whole minutes", async () => {
    // 30:34 is 30.5666... minutes, which the `real` column stores at single
    // precision; the set must still be recognised as the recording's.
    const day = await seedDay("Tempo run", {
      exerciseName: "run",
      category: "running",
      distance: 8000,
    });
    const log = await autoLink(day, { ...SHORT_RUN, id: 778003, moving_time: 30 * 60 + 34 });
    await db.update(workoutLogs).set({ rpe: 7 }).where(eq(workoutLogs.id, log.id));

    const result = await unlinkDeviceActivity({
      userId: ATHLETE,
      logId: log.id,
      distanceUnit: "km",
    });

    expect(result.log).toMatchObject({ id: log.id, rpe: 7 });
    expect(await athleteRunSets()).toEqual([
      { workoutLogId: result.standalone.id, distance: 6100 },
    ]);
  });

  it("reopening a strength day a 'Weight Training' recording completed keeps the prescribed lifts", async () => {
    const day = await seedDay("Strength", BACK_SQUAT);
    await autoLink(day, WEIGHT_TRAINING);

    await updatePlanDayStatus(day.id, { status: "planned" }, ATHLETE);

    const prescribed = await db
      .select({
        exerciseName: exerciseSets.exerciseName,
        reps: exerciseSets.reps,
        weight: exerciseSets.weight,
      })
      .from(exerciseSets)
      .where(eq(exerciseSets.planDayId, day.id));
    expect(prescribed).toEqual([{ exerciseName: "back_squat", reps: 5, weight: 110 }]);
    const [dayAfter] = await db
      .select({ status: planDays.status })
      .from(planDays)
      .where(eq(planDays.id, day.id));
    expect(dayAfter.status).toBe("planned");
  });

  it("reopening a day an auto link completed before D12 puts its prescription back once, not twice", async () => {
    const day = await seedDay("Strength", BACK_SQUAT, 3);
    // Before D12 an auto link built its log the way a manual link still does:
    // the prescription copied in, each set with its planned* snapshot.
    const log = await autoLink(day, WEIGHT_TRAINING, "manual");
    await db
      .update(workoutLogs)
      .set({ deviceLinkSource: "auto" })
      .where(eq(workoutLogs.id, log.id));

    await updatePlanDayStatus(day.id, { status: "planned" }, ATHLETE);

    expect(await daySets(day.id)).toEqual(
      [0, 1, 2].map((sortOrder) => ({
        exerciseName: "back_squat",
        distance: null,
        reps: 5,
        weight: 110,
        sortOrder,
      })),
    );
  });

  it("reopening a 'Weight Training' day puts the lifts the athlete typed on the day in place of the prescribed ones", async () => {
    const day = await seedDay("Strength", BACK_SQUAT, 3);
    const log = await autoLink(day, WEIGHT_TRAINING);
    // The link wrote no set; they lifted 100 kg, not the prescribed 110.
    for (let setNumber = 1; setNumber <= 3; setNumber++) {
      await seedExerciseSet({
        workoutLogId: log.id,
        ...BACK_SQUAT,
        weight: 100,
        setNumber,
        sortOrder: setNumber - 1,
      });
    }

    await updatePlanDayStatus(day.id, { status: "planned" }, ATHLETE);

    expect(await daySets(day.id)).toEqual(
      [0, 1, 2].map((sortOrder) => ({
        exerciseName: "back_squat",
        distance: null,
        reps: 5,
        weight: 100,
        sortOrder,
      })),
    );
  });

  it("reopening a run day whose recorded run the athlete corrected puts the corrected run on the day, once", async () => {
    const day = await seedDay("Tempo run", {
      exerciseName: "tempo_run",
      category: "running",
      distance: 8000,
    });
    const log = await autoLink(day, SHORT_RUN);
    // Storage bumps the version on every update, so the set is no longer the
    // untouched recording set.
    await db
      .update(exerciseSets)
      .set({ distance: 6000, version: 2 })
      .where(eq(exerciseSets.workoutLogId, log.id));

    await updatePlanDayStatus(day.id, { status: "planned" }, ATHLETE);

    expect(await daySets(day.id)).toEqual([
      { exerciseName: "run", distance: 6000, reps: null, weight: null, sortOrder: 0 },
    ]);
    // The recording's own row carries what the watch measured.
    expect((await athleteRunSets()).map((set) => set.distance)).toEqual([6100]);
  });

  it("reopening a run day whose recorded run the athlete only annotated keeps the 8 km", async () => {
    // D12 (CODEBASE_ANALYSIS_2026-10-03): a per-set note bumps the version but
    // leaves both of the watch's numbers. Read as a correction, the 6.1 km
    // replaced the prescribed 8 km; read as a run the athlete added, it went
    // onto the day while the release wrote it on the recording's row too, so
    // completing the day again counted it twice. It leaves with the
    // recording, as on unlink, and the note goes onto the released row's set.
    const day = await seedDay("Tempo run", { exerciseName: "tempo_run", category: "running", distance: 8000 });
    const log = await autoLink(day, SHORT_RUN);
    const [recordingSet] = await db.select().from(exerciseSets).where(eq(exerciseSets.workoutLogId, log.id));
    const noted = await storage.workouts.mutateExerciseSetUpdate(
      { kind: "workoutLog", ownerId: log.id },
      recordingSet.id,
      { notes: "windy" },
      ATHLETE,
    );
    expect(noted).toMatchObject({ version: 2, distance: 6100, notes: "windy" });

    await updatePlanDayStatus(day.id, { status: "planned" }, ATHLETE);

    expect(await daySets(day.id)).toEqual([
      { exerciseName: "tempo_run", distance: 8000, reps: null, weight: null, sortOrder: 0 },
    ]);
    // The log is gone: the one run left is on the released recording's row.
    const runs = await athleteRunSets();
    expect(runs.map((set) => set.distance)).toEqual([6100]);
    const [released] = await db
      .select({ notes: exerciseSets.notes })
      .from(exerciseSets)
      .where(eq(exerciseSets.workoutLogId, runs[0].workoutLogId ?? ""));
    expect(released).toEqual({ notes: "windy" });
  });

  it("reopening a mixed day the athlete logged only the station on keeps the prescribed runs", async () => {
    const run = { exerciseName: "run", category: "running", distance: 1000 };
    const wallBalls = { exerciseName: "wall_balls", category: "functional", reps: 20 };
    const day = await seedSession("HYROX simulation", [run, wallBalls, run, wallBalls]);
    const log = await autoLink(day, SHORT_RUN);
    // The watch was on Run; the athlete added the wall balls they did, as one set of 25.
    await seedExerciseSet({
      workoutLogId: log.id,
      ...wallBalls,
      reps: 25,
      setNumber: 1,
      sortOrder: 1,
    });

    await updatePlanDayStatus(day.id, { status: "planned" }, ATHLETE);

    expect(await daySets(day.id)).toEqual([
      { exerciseName: "run", distance: 1000, reps: null, weight: null, sortOrder: 0 },
      { exerciseName: "wall_balls", distance: null, reps: 25, weight: null, sortOrder: 1 },
      { exerciseName: "run", distance: 1000, reps: null, weight: null, sortOrder: 2 },
    ]);
    // The watch's 6.1 km went with the recording, not onto the day.
    expect((await athleteRunSets()).map((set) => set.distance)).toEqual([6100]);
  });
});

import { exerciseSets, planDays, trainingPlans } from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../index";
import { resetIntegrationDb, seedExerciseSet, seedUser, seedWorkoutLog } from "./integrationDb";

/**
 * The exercise-set mutation predicates against the REAL schema: every
 * ownership check is a join (set → workout_log → user, or set → plan_day →
 * training_plan → user) that the mocked-db unit tests never execute. These
 * are the IDOR guards on the hottest write path in the app (cell saves), plus
 * the W18 optimistic lock and the L4 unit re-stamp, end to end.
 */
describe("WorkoutStorage set mutations — ownership, locking, unit stamps (real Postgres)", () => {
  const ALICE = "sets-alice";
  const BOB = "sets-bob";
  const LB_PREFS = { weightUnit: "lbs", distanceUnit: "miles" };

  let aliceLogId: string;
  let aliceSetId: string;

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE);
    await seedUser(BOB, { weightUnit: "lbs", distanceUnit: "miles" });
    const log = await seedWorkoutLog(ALICE, "2026-08-10");
    aliceLogId = log.id;
    const set = await seedExerciseSet({
      workoutLogId: log.id,
      exerciseName: "back_squat",
      category: "strength",
      setNumber: 1,
      reps: 5,
      weight: 100,
      plannedWeight: 90,
      weightUnit: "kg",
      distance: 400,
      distanceUnit: "m",
    });
    aliceSetId = set.id;
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  async function readSet(id: string) {
    const [row] = await db.select().from(exerciseSets).where(eq(exerciseSets.id, id));
    return row;
  }

  describe("ownership (IDOR guards)", () => {
    it("refuses an update from a user who does not own the workout — and leaves the row untouched", async () => {
      const result = await storage.workouts.mutateExerciseSetUpdate(
        { kind: "workoutLog", ownerId: aliceLogId },
        aliceSetId,
        { reps: 99 },
        BOB,
      );

      expect(result).toBeUndefined();
      expect((await readSet(aliceSetId)).reps).toBe(5);
    });

    it("refuses an update addressed through a container the set does not belong to", async () => {
      const otherLog = await seedWorkoutLog(ALICE, "2026-08-11");

      const result = await storage.workouts.mutateExerciseSetUpdate(
        { kind: "workoutLog", ownerId: otherLog.id },
        aliceSetId,
        { reps: 99 },
        ALICE,
      );

      expect(result).toBeUndefined();
      expect((await readSet(aliceSetId)).reps).toBe(5);
    });

    it("applies the owner's update and bumps the version", async () => {
      const result = await storage.workouts.mutateExerciseSetUpdate(
        { kind: "workoutLog", ownerId: aliceLogId },
        aliceSetId,
        { reps: 8 },
        ALICE,
      );

      expect(result).toMatchObject({ id: aliceSetId, reps: 8, version: 2 });
    });

    it("never deletes another user's set", async () => {
      await storage.workouts.mutateExerciseSetDelete({ kind: "workoutLog", ownerId: aliceLogId }, aliceSetId, BOB);

      expect(await readSet(aliceSetId)).toBeDefined();
    });

    it("lets the owner delete, and reports true", async () => {
      const deleted = await storage.workouts.mutateExerciseSetDelete(
        { kind: "workoutLog", ownerId: aliceLogId },
        aliceSetId,
        ALICE,
      );

      expect(deleted).toBe(true);
      expect(await readSet(aliceSetId)).toBeUndefined();
    });

    it("guards plan-day prescriptions through the plan's owner (set → plan_day → training_plan → user)", async () => {
      const [plan] = await db
        .insert(trainingPlans)
        .values({ userId: ALICE, name: "Alice's block", totalWeeks: 4 })
        .returning();
      const [day] = await db
        .insert(planDays)
        .values({ planId: plan.id, weekNumber: 1, dayName: "Monday", focus: "Strength", mainWorkout: "Squats" })
        .returning();

      const byBob = await storage.workouts.mutateExerciseSetAdd(
        { kind: "planDay", ownerId: day.id },
        { exerciseName: "back_squat", category: "strength", setNumber: 1, plannedReps: 5 },
        BOB,
      );
      expect(byBob).toBeUndefined();

      const first = await storage.workouts.mutateExerciseSetAdd(
        { kind: "planDay", ownerId: day.id },
        { exerciseName: "back_squat", category: "strength", setNumber: 1, plannedReps: 5 },
        ALICE,
      );
      const second = await storage.workouts.mutateExerciseSetAdd(
        { kind: "planDay", ownerId: day.id },
        { exerciseName: "back_squat", category: "strength", setNumber: 2, plannedReps: 5 },
        ALICE,
      );
      expect(first).toMatchObject({ planDayId: day.id, workoutLogId: null, sortOrder: 0 });
      // The correlated MAX+1 subquery appends, rather than colliding at 0.
      expect(second).toMatchObject({ planDayId: day.id, sortOrder: 1 });
    });
  });

  describe("optimistic locking (W18)", () => {
    it("rejects a stale expectedVersion with a 409 carrying the current version", async () => {
      await storage.workouts.mutateExerciseSetUpdate(
        { kind: "workoutLog", ownerId: aliceLogId },
        aliceSetId,
        { reps: 6 },
        ALICE,
      ); // version is now 2

      await expect(
        storage.workouts.mutateExerciseSetUpdate(
          { kind: "workoutLog", ownerId: aliceLogId },
          aliceSetId,
          { reps: 7, expectedVersion: 1 },
          ALICE,
        ),
      ).rejects.toMatchObject({ status: 409, details: { currentVersion: 2, expectedVersion: 1 } });

      expect((await readSet(aliceSetId)).reps).toBe(6);
    });

    it("accepts a matching expectedVersion", async () => {
      const result = await storage.workouts.mutateExerciseSetUpdate(
        { kind: "workoutLog", ownerId: aliceLogId },
        aliceSetId,
        { reps: 7, expectedVersion: 1 },
        ALICE,
      );

      expect(result).toMatchObject({ reps: 7, version: 2 });
    });
  });

  describe("unit re-stamp on partial patches (audit L4)", () => {
    it("re-stamps the weight axis and converts the untouched planned weight when a lbs athlete edits a kg row", async () => {
      const result = await storage.workouts.mutateExerciseSetUpdate(
        { kind: "workoutLog", ownerId: aliceLogId },
        aliceSetId,
        { weight: 230, unitPreferences: LB_PREFS },
        ALICE,
      );

      expect(result).toMatchObject({ weight: 230, weightUnit: "lbs", plannedWeight: 198 });
      // The untouched distance axis keeps its metre stamp and value.
      expect(result).toMatchObject({ distance: 400, distanceUnit: "m" });
      // The pseudo-field never lands in the row.
      expect(Object.keys(result ?? {})).not.toContain("unitPreferences");
    });

    it("leaves both stamps alone for a reps-only edit", async () => {
      const result = await storage.workouts.mutateExerciseSetUpdate(
        { kind: "workoutLog", ownerId: aliceLogId },
        aliceSetId,
        { reps: 3, unitPreferences: LB_PREFS },
        ALICE,
      );

      expect(result).toMatchObject({ reps: 3, weight: 100, weightUnit: "kg", distance: 400, distanceUnit: "m" });
    });
  });
});

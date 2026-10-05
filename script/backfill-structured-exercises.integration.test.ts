import {
  exerciseSets,
  type InsertExerciseSet,
  planDays,
  trainingPlans,
  users,
  workoutLogs,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Nothing here reaches the parser; stub it so importing the script needs no provider.
vi.mock("../server/gemini", () => ({ parseExercisesFromText: vi.fn() }));

import { db } from "../server/db";
import {
  resetIntegrationDb,
  seedExerciseSet,
  seedUser,
  seedWorkoutLog,
} from "../server/storage/__tests__/integrationDb";
import {
  type BackfillCandidate,
  type Flags,
  insertIfStillUnstructured,
  loadPlanDayCandidates,
  loadWorkoutLogCandidates,
} from "./backfill-structured-exercises";

const CONSENTING = "backfill-consenting";
const DECLINING = "backfill-declining";

function flagsFor(userId: string): Flags {
  return { dryRun: false, userId, batchSize: 500, planDaysOnly: false, workoutsOnly: false };
}

async function setsOf(workoutLogId: string) {
  return await db.select().from(exerciseSets).where(eq(exerciseSets.workoutLogId, workoutLogId));
}

function parsedRows(workoutLogId: string): InsertExerciseSet[] {
  return [
    { workoutLogId, exerciseName: "back_squat", category: "strength", setNumber: 1, reps: 5 },
    { workoutLogId, exerciseName: "back_squat", category: "strength", setNumber: 2, reps: 5 },
  ];
}

async function workoutCandidate(workoutLogId: string): Promise<BackfillCandidate> {
  const candidates = await loadWorkoutLogCandidates(flagsFor(CONSENTING));
  const cand = candidates.find((c) => c.ownerId === workoutLogId);
  if (!cand) throw new Error(`no candidate for ${workoutLogId}`);
  return cand;
}

describe("backfill-structured-exercises (real Postgres)", () => {
  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(CONSENTING);
    await seedUser(DECLINING);
    await db.update(users).set({ aiCoachEnabled: true }).where(eq(users.id, CONSENTING));
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  describe("candidates (P14)", () => {
    it("only loads the workouts of athletes who consent to AI processing", async () => {
      const mine = await seedWorkoutLog(CONSENTING, "2026-09-01");
      await seedWorkoutLog(DECLINING, "2026-09-01");

      expect((await loadWorkoutLogCandidates(flagsFor(CONSENTING))).map((c) => c.ownerId)).toEqual([
        mine.id,
      ]);
      expect(await loadWorkoutLogCandidates(flagsFor(DECLINING))).toEqual([]);
    });

    it("only loads the plan days of athletes who consent to AI processing", async () => {
      async function seedPlanDay(userId: string) {
        const [plan] = await db
          .insert(trainingPlans)
          .values({ userId, name: "Block", totalWeeks: 1 })
          .returning();
        const [day] = await db
          .insert(planDays)
          .values({
            planId: plan.id,
            weekNumber: 1,
            dayName: "Monday",
            focus: "Strength",
            mainWorkout: "5x5 Back Squat",
          })
          .returning();
        return day;
      }
      const mine = await seedPlanDay(CONSENTING);
      await seedPlanDay(DECLINING);

      expect((await loadPlanDayCandidates(flagsFor(CONSENTING))).map((c) => c.ownerId)).toEqual([
        mine.id,
      ]);
      expect(await loadPlanDayCandidates(flagsFor(DECLINING))).toEqual([]);
    });
  });

  describe("insertIfStillUnstructured (D28)", () => {
    it("writes the parsed sets when the workout still has none", async () => {
      const log = await seedWorkoutLog(CONSENTING, "2026-09-02");
      const cand = await workoutCandidate(log.id);

      expect(await insertIfStillUnstructured(cand, parsedRows(log.id))).toBe("written");
      expect(await setsOf(log.id)).toHaveLength(2);
    });

    it("does not add a second copy when the athlete logged sets after the snapshot", async () => {
      const log = await seedWorkoutLog(CONSENTING, "2026-09-03");
      const cand = await workoutCandidate(log.id);
      // The athlete logs the session by hand while the run waits on Gemini.
      await seedExerciseSet({
        workoutLogId: log.id,
        exerciseName: "deadlift",
        category: "strength",
        setNumber: 1,
      });

      expect(await insertIfStillUnstructured(cand, parsedRows(log.id))).toBe("already_structured");
      expect((await setsOf(log.id)).map((set) => set.exerciseName)).toEqual(["deadlift"]);
    });

    it("skips a workout deleted after the snapshot instead of failing on the foreign key", async () => {
      const log = await seedWorkoutLog(CONSENTING, "2026-09-04");
      const cand = await workoutCandidate(log.id);
      await db.delete(workoutLogs).where(eq(workoutLogs.id, log.id));

      expect(await insertIfStillUnstructured(cand, parsedRows(log.id))).toBe("owner_deleted");
    });

    it("waits for an in-flight write of the same workout's sets, then sees it", async () => {
      const log = await seedWorkoutLog(CONSENTING, "2026-09-05");
      const cand = await workoutCandidate(log.id);

      // A concurrent writer (an athlete edit or a second run) has inserted a
      // set but not committed: its foreign-key check holds FOR KEY SHARE on
      // the workout row until it does.
      const writerMayCommit = Promise.withResolvers<void>();
      const writerInserted = Promise.withResolvers<void>();
      const writer = db.transaction(async (tx) => {
        await tx
          .insert(exerciseSets)
          .values({
            workoutLogId: log.id,
            exerciseName: "deadlift",
            category: "strength",
            setNumber: 1,
          });
        writerInserted.resolve();
        await writerMayCommit.promise;
      });
      await writerInserted.promise;

      let settled = false;
      const backfill = insertIfStillUnstructured(cand, parsedRows(log.id)).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      // Blocked on the row lock rather than reading past the uncommitted set.
      expect(settled).toBe(false);

      writerMayCommit.resolve();
      await writer;
      expect(await backfill).toBe("already_structured");
      expect(await setsOf(log.id)).toHaveLength(1);
    });
  });
});

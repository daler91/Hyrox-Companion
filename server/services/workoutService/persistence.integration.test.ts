import { exerciseSets, type InsertExerciseSet, workoutLogs, workoutStructureBlocks } from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../../storage";
import { resetIntegrationDb, seedExerciseSet, seedUser, seedWorkoutLog } from "../../storage/__tests__/integrationDb";
import { replaceExerciseSetsAndStructureByOwner, saveParsedWorkoutsBatch } from "./persistence";

/**
 * The batch reparse writer against the REAL schema. `batchReparseWorkouts`
 * snapshots "workouts with no sets" once and then spends minutes on AI parses,
 * so a set the athlete logs by hand in that window must survive the chunk's
 * write (D17, CODEBASE_ANALYSIS_2026-10-03). This runs the actual lock and
 * re-check SQL, which the mocked unit test next door cannot.
 */
describe("saveParsedWorkoutsBatch (real Postgres)", () => {
  const ALICE = "reparse-alice";

  function parsedSet(workoutLogId: string): InsertExerciseSet {
    return { workoutLogId, exerciseName: "back_squat", category: "strength", setNumber: 1, reps: 5, weight: 60, weightUnit: "kg" };
  }

  async function setsFor(workoutLogId: string) {
    return db.select().from(exerciseSets).where(eq(exerciseSets.workoutLogId, workoutLogId));
  }

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("keeps the sets an athlete logged by hand after the snapshot, and writes the rest", async () => {
    const untouched = await seedWorkoutLog(ALICE, "2026-08-10", { mainWorkout: "5x5 back squat @ 60kg" });
    const handLogged = await seedWorkoutLog(ALICE, "2026-08-11", { mainWorkout: "3x8 deadlift @ 100kg" });
    const snapshot = await storage.workouts.getWorkoutsWithoutExerciseSets(ALICE);
    expect(snapshot.map((w) => w.id).sort()).toEqual([untouched.id, handLogged.id].sort());

    // Mid-run, the athlete opens the second workout and logs a set themselves.
    const own = await seedExerciseSet({
      workoutLogId: handLogged.id,
      exerciseName: "deadlift",
      category: "strength",
      setNumber: 1,
      reps: 8,
      weight: 100,
      weightUnit: "kg",
    });

    const result = await saveParsedWorkoutsBatch(
      snapshot.map((w) => ({ workoutId: w.id, setRows: [parsedSet(w.id)] })),
    );

    expect(result).toEqual({ saved: 1, failed: 0, skipped: 1 });
    expect(await setsFor(handLogged.id)).toEqual([expect.objectContaining({ id: own.id, exerciseName: "deadlift", weight: 100 })]);
    expect(await setsFor(untouched.id)).toEqual([expect.objectContaining({ exerciseName: "back_squat", weight: 60 })]);
  });

  it("skips a workout deleted since the snapshot instead of failing the whole chunk", async () => {
    const kept = await seedWorkoutLog(ALICE, "2026-08-10");
    const deleted = await seedWorkoutLog(ALICE, "2026-08-11");
    await db.delete(workoutLogs).where(eq(workoutLogs.id, deleted.id));

    const result = await saveParsedWorkoutsBatch([
      { workoutId: kept.id, setRows: [parsedSet(kept.id)] },
      { workoutId: deleted.id, setRows: [parsedSet(deleted.id)] },
    ]);

    expect(result).toEqual({ saved: 1, failed: 0, skipped: 1 });
    expect(await setsFor(kept.id)).toHaveLength(1);
  });
});

/**
 * Tech debt #38 (c): a reparse whose structure blocks yielded no sets replaced
 * the owner's sets and structure with nothing, and the route then answered
 * 422. The replacement now rolls back when it would leave no sets.
 */
describe("replaceExerciseSetsAndStructureByOwner (real Postgres)", () => {
  const BOB = "reparse-bob";

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(BOB);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  async function loggedWithTwoSets() {
    const log = await seedWorkoutLog(BOB, "2026-08-12");
    for (const setNumber of [1, 2]) {
      await seedExerciseSet({ workoutLogId: log.id, exerciseName: "back_squat", category: "strength", setNumber, reps: 5, sortOrder: setNumber });
    }
    return log;
  }

  it("leaves the existing sets and structure alone when the parse yields none", async () => {
    const log = await loggedWithTwoSets();

    const written = await replaceExerciseSetsAndStructureByOwner({ workoutLogId: log.id }, [], [
      { sectionType: "main", formatType: "steady", sortOrder: 0, steps: [] },
    ]);

    expect(written).toBe(0);
    const sets = await db.select().from(exerciseSets).where(eq(exerciseSets.workoutLogId, log.id));
    expect(sets.map((set) => set.setNumber).sort()).toEqual([1, 2]);
    const blocks = await db.select().from(workoutStructureBlocks).where(eq(workoutStructureBlocks.workoutLogId, log.id));
    expect(blocks).toEqual([]);
  });

  it("still replaces the sets when the parse yields some", async () => {
    const log = await loggedWithTwoSets();

    const written = await replaceExerciseSetsAndStructureByOwner({ workoutLogId: log.id }, [
      { workoutLogId: log.id, exerciseName: "deadlift", category: "strength", setNumber: 1, reps: 3, sortOrder: 0 },
    ]);

    expect(written).toBe(1);
    const sets = await db.select().from(exerciseSets).where(eq(exerciseSets.workoutLogId, log.id));
    expect(sets.map((set) => set.exerciseName)).toEqual(["deadlift"]);
  });
});

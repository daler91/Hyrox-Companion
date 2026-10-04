import { exerciseSets, type InsertExerciseSet, workoutLogs } from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../../storage";
import { resetIntegrationDb, seedExerciseSet, seedUser, seedWorkoutLog } from "../../storage/__tests__/integrationDb";
import { saveParsedWorkoutsBatch } from "./persistence";

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

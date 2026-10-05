import {
  type StructureBlockInput,
  workoutStructureBlocks,
  workoutStructureSteps,
} from "@shared/schema";
import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import {
  resetIntegrationDb,
  seedUser,
  seedWorkoutLog,
} from "../../storage/__tests__/integrationDb";
import { updateWorkout } from "./workouts";

/**
 * The workout sheet's block builder PATCHes `{ structureBlocks }` and nothing
 * else. drizzle's `.set({})` throws "No values to set", so that PATCH failed on
 * every edit and the builder rolled back (CL14, CODEBASE_ANALYSIS_2026-10-03).
 * Runs the real UPDATE against Postgres, which the mocked unit tests cannot.
 */
describe("updateWorkout structure-only PATCH (real Postgres)", () => {
  const ALICE = "structure-patch-alice";
  const BOB = "structure-patch-bob";

  const emomBlock: StructureBlockInput = {
    id: "8f7c1e52-5f43-4f2b-9d0a-4a1f3c2b1e01",
    sectionType: "main",
    formatType: "emom",
    durationMinutes: 10,
    sequenceOrder: 0,
    sortOrder: 0,
    steps: [
      { stepNumber: 1, minuteIndex: 1, stepType: "work", exerciseName: "Wall Balls" },
      { stepNumber: 2, minuteIndex: 2, stepType: "work", exerciseName: "Burpees" },
    ],
  };

  async function savedSteps(workoutLogId: string) {
    const blocks = await db
      .select({ id: workoutStructureBlocks.id })
      .from(workoutStructureBlocks)
      .where(eq(workoutStructureBlocks.workoutLogId, workoutLogId));
    if (blocks.length === 0) return [];
    return db
      .select({
        stepNumber: workoutStructureSteps.stepNumber,
        exerciseName: workoutStructureSteps.exerciseName,
      })
      .from(workoutStructureSteps)
      .where(
        inArray(
          workoutStructureSteps.blockId,
          blocks.map((b) => b.id),
        ),
      )
      .orderBy(asc(workoutStructureSteps.stepNumber));
  }

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE);
    await seedUser(BOB);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("saves the blocks when the PATCH carries no column values", async () => {
    const log = await seedWorkoutLog(ALICE, "2026-09-01", { focus: "Engine" });

    const updated = await updateWorkout(log.id, {}, undefined, ALICE, [emomBlock]);

    expect(updated).toEqual(expect.objectContaining({ id: log.id, focus: "Engine" }));
    expect(await savedSteps(log.id)).toEqual([
      { stepNumber: 1, exerciseName: "Wall Balls" },
      { stepNumber: 2, exerciseName: "Burpees" },
    ]);
  });

  it("saves the blocks alongside an exercise list when no column changes", async () => {
    const log = await seedWorkoutLog(ALICE, "2026-09-02");

    const updated = await updateWorkout(log.id, {}, [], ALICE, [emomBlock]);

    expect(updated).toEqual(expect.objectContaining({ id: log.id }));
    expect(await savedSteps(log.id)).toHaveLength(2);
  });

  it("still refuses another athlete's workout", async () => {
    const log = await seedWorkoutLog(ALICE, "2026-09-03");

    expect(await updateWorkout(log.id, {}, undefined, BOB, [emomBlock])).toBeNull();
    expect(await updateWorkout(log.id, {}, [], BOB, [emomBlock])).toBeNull();
    expect(await savedSteps(log.id)).toEqual([]);
  });
});

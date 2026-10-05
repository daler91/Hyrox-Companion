import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { storage } from "../index";
import { resetIntegrationDb, seedExerciseSet, seedUser, seedWorkoutLog } from "./integrationDb";

/**
 * prSetCount against the REAL schema: a workout's PRs are measured against the
 * workouts logged BEFORE it, in kg through each set's own unit stamp. It used
 * to compare against every other workout, so a March PR read 0 once a heavier
 * June lift existed, and raw kg and lbs numbers were compared as if one unit
 * (C45, CODEBASE_ANALYSIS_2026-10-03).
 */
describe("WorkoutStorage.getWorkoutHistoryStats prSetCount (real Postgres)", () => {
  const ALICE = "history-stats-alice";

  async function squatSession(date: string, weight: number, weightUnit: string) {
    const log = await seedWorkoutLog(ALICE, date);
    await seedExerciseSet({
      workoutLogId: log.id,
      exerciseName: "back_squat",
      category: "strength",
      setNumber: 1,
      reps: 5,
      weight,
      weightUnit,
    });
    return log;
  }

  async function prSetCount(workoutLogId: string): Promise<number | undefined> {
    return (await storage.workouts.getWorkoutHistoryStats(workoutLogId, ALICE))?.prSetCount;
  }

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE, { weightUnit: "lbs" });
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("keeps a PR a PR after a heavier lift is logged later", async () => {
    await squatSession("2026-02-01", 90, "kg");
    const march = await squatSession("2026-03-01", 100, "kg");
    await squatSession("2026-06-01", 120, "kg");

    expect(await prSetCount(march.id)).toBe(1);
  });

  it("compares kg and lbs sets in one unit", async () => {
    // 200 lbs is ~91 kg: below the 100 kg best, though 200 > 100 raw.
    await squatSession("2026-02-01", 100, "kg");
    const lighter = await squatSession("2026-03-01", 200, "lbs");
    // 225 lbs is ~102 kg: a record over both.
    const heavier = await squatSession("2026-04-01", 225, "lbs");

    expect(await prSetCount(lighter.id)).toBe(0);
    expect(await prSetCount(heavier.id)).toBe(1);
  });

  it("lets only one of two same-day sessions count the other as its baseline", async () => {
    await squatSession("2026-02-01", 90, "kg");
    const first = await squatSession("2026-03-01", 100, "kg");
    const second = await squatSession("2026-03-01", 100, "kg");

    // Equal to each other and both over February: whichever sorts first is
    // the record, the other merely equals it.
    const counts = [await prSetCount(first.id), await prSetCount(second.id)];
    expect(counts).toHaveLength(2);
    expect(counts).toEqual(expect.arrayContaining([0, 1]));
  });
});

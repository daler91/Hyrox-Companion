import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { storage } from "../index";
import { resetIntegrationDb, seedUser, seedWorkoutLog } from "./integrationDb";

/**
 * The `onlyTraining` filter on listWorkoutLogs / countWorkoutLogs against the
 * REAL schema. It is the training-only staleness anchor for race_prediction and
 * overview_analysis: a synced walk must not move it, while the unfiltered
 * reads (coach_insights' anchor) still count every log.
 * PF10 (CODEBASE_ANALYSIS_2026-10-03)
 */
describe("WorkoutStorage training-only log reads (real Postgres)", () => {
  const ALICE = "log-filter-alice";
  const BOB = "log-filter-bob";
  const walk = {
    focus: "Walk",
    mainWorkout: "Walk",
    source: "strava",
    countsAsTraining: false,
  } as const;

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE);
    await seedUser(BOB);
    await seedWorkoutLog(ALICE, "2026-05-01");
    await seedWorkoutLog(ALICE, "2026-05-03", { focus: "Second session" });
    await seedWorkoutLog(ALICE, "2026-05-05", walk);
    await seedWorkoutLog(ALICE, "2026-05-06", walk);
    // Another athlete's newer training log never leaks into Alice's anchor.
    await seedWorkoutLog(BOB, "2026-05-09");
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("anchors on training logs only when asked", async () => {
    const onlyTraining = { onlyTraining: true };
    const [latestTraining] = await storage.workouts.listWorkoutLogs(ALICE, 1, 0, onlyTraining);

    expect(latestTraining.date).toBe("2026-05-03");
    expect(await storage.workouts.countWorkoutLogs(ALICE, onlyTraining)).toBe(2);
  });

  it("still counts every log, walks included, without the filter", async () => {
    const [latest] = await storage.workouts.listWorkoutLogs(ALICE, 1);

    expect(latest.date).toBe("2026-05-06");
    expect(await storage.workouts.countWorkoutLogs(ALICE)).toBe(4);
    expect(await storage.workouts.countWorkoutLogs(ALICE, { onlyTraining: false })).toBe(4);
  });

  it("returns nothing for an athlete whose only logs are walks", async () => {
    const onlyTraining = { onlyTraining: true };
    await resetIntegrationDb();
    await seedUser(ALICE);
    await seedWorkoutLog(ALICE, "2026-05-05", walk);

    expect(await storage.workouts.listWorkoutLogs(ALICE, 1, 0, onlyTraining)).toEqual([]);
    expect(await storage.workouts.countWorkoutLogs(ALICE, onlyTraining)).toBe(0);
  });
});

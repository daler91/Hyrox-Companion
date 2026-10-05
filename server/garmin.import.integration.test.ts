import { exerciseSets, users, workoutLogs } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "./db";
import { __testing } from "./garmin";
import type { GarminActivity } from "./services/garminMapper";
import { storage } from "./storage";
import { seedUser } from "./storage/__tests__/integrationDb";

/**
 * C26 (CODEBASE_ANALYSIS_2026-10-03), against the real schema: a Garmin import
 * wrote its log and no exercise set, so a Garmin-only athlete's runs never
 * reached the set-derived Analytics panels. The log and its synthesised set
 * now commit together, the Strava standalone import's shape (D47).
 *
 * Cleans up only its own athlete rather than resetting the whole database.
 */

const ATHLETE = "garmin-import-athlete";

const RUN: GarminActivity = {
  activityId: 4_400_001,
  activityName: "Evening Run",
  startTimeLocal: "2026-06-03 18:30:00",
  startTimeGMT: "2026-06-03 17:30:00",
  activityType: { typeKey: "running" },
  distance: 10_000,
  duration: 3050,
  movingDuration: 3001,
  averageHR: 152,
};

const LIFT: GarminActivity = {
  activityId: 4_400_002,
  activityName: "Gym",
  startTimeLocal: "2026-06-04 07:00:00",
  startTimeGMT: "2026-06-04 06:00:00",
  activityType: { typeKey: "strength_training" },
  duration: 3600,
};

async function importedLogs() {
  return await db
    .select()
    .from(workoutLogs)
    .where(and(eq(workoutLogs.userId, ATHLETE), eq(workoutLogs.source, "garmin")));
}

async function setsFor(logIds: string[]) {
  if (logIds.length === 0) return [];
  return await db.select().from(exerciseSets).where(inArray(exerciseSets.workoutLogId, logIds));
}

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
  await db.delete(users).where(eq(users.id, ATHLETE));
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

describe("a Garmin import and its synthesised set (C26)", () => {
  it("writes a run's set, timed in seconds, and none for a session no set describes", async () => {
    const result = await __testing.importGarminActivities([RUN, LIFT], ATHLETE);

    expect(result).toEqual({ imported: 2, skipped: 0, total: 2 });
    const logs = await importedLogs();
    expect(logs).toHaveLength(2);
    const run = logs.find((log) => log.garminActivityId === String(RUN.activityId));
    const sets = await setsFor(logs.map((log) => log.id));
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ workoutLogId: run?.id, exerciseName: "run", distance: 10_000 });
    // `time` is a real column, so compare to its precision; 50 even would be the rounded row.
    expect(sets[0].time).toBeCloseTo(3001 / 60, 4);
  });

  it("commits neither when the set insert fails, so the next sync imports the activity whole", async () => {
    vi.spyOn(storage.workouts, "createDeviceActivitySets").mockRejectedValueOnce(
      new Error("connection reset"),
    );

    await expect(__testing.importGarminActivities([RUN], ATHLETE)).rejects.toThrow(
      "connection reset",
    );
    expect(await importedLogs()).toHaveLength(0);

    const result = await __testing.importGarminActivities([RUN], ATHLETE);

    expect(result).toMatchObject({ imported: 1, skipped: 0 });
    const logs = await importedLogs();
    expect(await setsFor(logs.map((log) => log.id))).toHaveLength(1);
  });
});

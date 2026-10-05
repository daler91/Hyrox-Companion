import { exerciseSets, type StravaActivitySummary, users, workoutLogs } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../db";
import { storage } from "../storage";
import { seedUser } from "../storage/__tests__/integrationDb";
import { mapStravaActivityToWorkout } from "./stravaMapper";
import { reconcileStravaActivities, type StravaImportItem } from "./stravaReconciler";

/**
 * D47 (CODEBASE_ANALYSIS_2026-10-03), against the real schema: a standalone
 * import committed its log and its synthesised exercise set in separate
 * statements. A fault between them left the log with no set for good, since
 * every later sync dedupes the activity, so the session was missing from
 * every set-derived panel. The two now commit together.
 *
 * Cleans up only its own athlete rather than resetting the whole database.
 */

const ATHLETE = "reconciler-atomic-athlete";
const silentLog = { info: vi.fn(), warn: vi.fn() };

const RUN: StravaActivitySummary = {
  id: 783001,
  name: "Evening Run",
  type: "Run",
  sport_type: "Run",
  start_date: "2026-06-03T17:30:00Z",
  start_date_local: "2026-06-03T18:30:00Z",
  distance: 10_000,
  moving_time: 50 * 60,
  elapsed_time: 52 * 60,
  total_elevation_gain: 35,
  average_speed: 3.33,
  max_speed: 4.4,
};

function item(activity: StravaActivitySummary): StravaImportItem {
  return { activity, row: mapStravaActivityToWorkout(activity, ATHLETE, "km") };
}

async function importedLogs() {
  return await db
    .select()
    .from(workoutLogs)
    .where(and(eq(workoutLogs.userId, ATHLETE), eq(workoutLogs.stravaActivityId, String(RUN.id))));
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

describe("a standalone Strava import and its synthesised set (D47)", () => {
  it("commits neither when the set insert fails, so the next sync imports the activity whole", async () => {
    vi.spyOn(storage.workouts, "createDeviceActivitySets").mockRejectedValueOnce(
      new Error("connection reset"),
    );

    await expect(reconcileStravaActivities(ATHLETE, [item(RUN)], silentLog)).rejects.toThrow(
      "connection reset",
    );
    expect(await importedLogs()).toHaveLength(0);

    const counts = await reconcileStravaActivities(ATHLETE, [item(RUN)], silentLog);

    expect(counts).toMatchObject({ standalone: 1, skipped: 0 });
    const [log] = await importedLogs();
    const sets = await db.select().from(exerciseSets).where(eq(exerciseSets.workoutLogId, log.id));
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ exerciseName: "run", distance: 10_000 });
  });
});

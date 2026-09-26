import type { SessionStreamSamples } from "@shared/schema";
import { planDays, stravaConnections, trainingPlans, workoutLogStreams } from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../index";
import { resetIntegrationDb, seedUser, seedWorkoutLog } from "./integrationDb";

/**
 * The session-stream bookkeeping against the REAL schema: what counts as
 * pending (never fetched, relinked, failed and due), the per-athlete scoping,
 * the budget ledger, and the cascade/purge paths. The worker's unit tests mock
 * all of this; only this proves the joins and the predicate.
 */
describe("SessionStreamStorage (real Postgres)", () => {
  const ALICE = "streams-alice";
  const BOB = "streams-bob";
  const WINDOW = {
    since: "2026-03-01",
    retryBefore: new Date("2026-09-26T06:00:00Z"),
    maxAttempts: 3,
    limit: 20,
  };
  const SAMPLES: SessionStreamSamples = {
    v: 1,
    bucketSeconds: 15,
    hr: [140, 141],
    dist: [50, 50],
    mov: [15, 15],
    has: { hr: true, distance: true },
    elapsedSeconds: 30,
    truncated: false,
  };

  async function seedPlanDay(userId: string, focus = "Threshold Run") {
    const [plan] = await db
      .insert(trainingPlans)
      .values({ userId, name: "Block", totalWeeks: 8, startDate: "2026-08-03", endDate: "2026-09-27" })
      .returning();
    const [day] = await db
      .insert(planDays)
      .values({ planId: plan.id, weekNumber: 7, dayName: "Tuesday", focus, mainWorkout: "3 x 10 min @ threshold" })
      .returning();
    return day;
  }

  async function seedLinkedRun(userId: string, date: string, activityId: string, focus?: string) {
    const day = await seedPlanDay(userId, focus);
    return await seedWorkoutLog(userId, date, {
      planDayId: day.id,
      planId: day.planId,
      stravaActivityId: activityId,
      source: "strava",
      focus: "Run",
    });
  }

  async function connect(userId: string, requiresReauth = false) {
    await db.insert(stravaConnections).values({
      userId,
      stravaAthleteId: `athlete-${userId}`,
      accessToken: "enc",
      refreshToken: "enc",
      expiresAt: new Date("2030-01-01"),
      requiresReauth,
    });
  }

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE);
    await seedUser(BOB);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("lists plan-linked Strava runs with no stream, newest first, only the athlete's own", async () => {
    const older = await seedLinkedRun(ALICE, "2026-09-01", "1");
    const newer = await seedLinkedRun(ALICE, "2026-09-20", "2");
    await seedLinkedRun(BOB, "2026-09-21", "3");
    // Not candidates: no recording, no plan day, or outside the window.
    await seedWorkoutLog(ALICE, "2026-09-22", { planDayId: (await seedPlanDay(ALICE)).id });
    await seedWorkoutLog(ALICE, "2026-09-23", { stravaActivityId: "4", source: "strava" });
    await seedLinkedRun(ALICE, "2026-01-10", "5");

    const pending = await storage.sessionStreams.listPendingForUser(ALICE, WINDOW);

    expect(pending.map((c) => c.workoutLogId)).toEqual([newer.id, older.id]);
    expect(pending[0]).toMatchObject({
      stravaActivityId: "2",
      planFocus: "Threshold Run",
      planMainWorkout: "3 x 10 min @ threshold",
      attempts: 0,
    });
  });

  it("drops a fetched run, keeps a failed one due a retry, and re-opens a relinked one", async () => {
    const fetched = await seedLinkedRun(ALICE, "2026-09-10", "10");
    const failedDue = await seedLinkedRun(ALICE, "2026-09-11", "11");
    const failedRecent = await seedLinkedRun(ALICE, "2026-09-12", "12");
    const failedOut = await seedLinkedRun(ALICE, "2026-09-13", "13");
    const relinked = await seedLinkedRun(ALICE, "2026-09-14", "14");

    const row = { userId: ALICE, samples: null, lastError: null };
    await storage.sessionStreams.upsertResult({ ...row, workoutLogId: fetched.id, stravaActivityId: "10", status: "ok", samples: SAMPLES, attempts: 0 });
    await storage.sessionStreams.upsertResult({ ...row, workoutLogId: failedDue.id, stravaActivityId: "11", status: "failed", attempts: 1 });
    await storage.sessionStreams.upsertResult({ ...row, workoutLogId: failedRecent.id, stravaActivityId: "12", status: "failed", attempts: 1 });
    await storage.sessionStreams.upsertResult({ ...row, workoutLogId: failedOut.id, stravaActivityId: "13", status: "failed", attempts: 3 });
    await storage.sessionStreams.upsertResult({ ...row, workoutLogId: relinked.id, stravaActivityId: "old", status: "failed", attempts: 2 });
    // Only the due retry's last attempt is old enough.
    await db
      .update(workoutLogStreams)
      .set({ lastAttemptAt: new Date("2026-09-25T00:00:00Z") })
      .where(eq(workoutLogStreams.workoutLogId, failedDue.id));

    const pending = await storage.sessionStreams.listPendingForUser(ALICE, {
      ...WINDOW,
      retryBefore: new Date("2026-09-25T12:00:00Z"),
    });

    expect(pending.map((c) => c.workoutLogId)).toEqual([relinked.id, failedDue.id]);
    // A relinked log starts its attempts afresh; a retry carries its count.
    expect(pending.map((c) => c.attempts)).toEqual([0, 1]);
  });

  it("upserts one row per log and reads it back with its samples", async () => {
    const run = await seedLinkedRun(ALICE, "2026-09-10", "20");
    await storage.sessionStreams.upsertResult({
      userId: ALICE, workoutLogId: run.id, stravaActivityId: "20", status: "failed", samples: null, attempts: 1, lastError: "http_503",
    });
    await storage.sessionStreams.upsertResult({
      userId: ALICE, workoutLogId: run.id, stravaActivityId: "20", status: "ok", samples: SAMPLES, attempts: 1, lastError: null,
    });

    const rows = await storage.sessionStreams.getForLogs(ALICE, [run.id]);
    expect(rows.size).toBe(1);
    const stored = rows.get(run.id);
    expect(stored).toMatchObject({ status: "ok", bucketSeconds: 15, lastError: null, attempts: 1 });
    expect(stored?.samples).toEqual(SAMPLES);
    expect(stored?.fetchedAt).toBeInstanceOf(Date);
    // Bob cannot read Alice's stream.
    expect((await storage.sessionStreams.getForLogs(BOB, [run.id])).size).toBe(0);
  });

  it("counts Strava reads since a moment, leaving skipped rows out of the ledger", async () => {
    const a = await seedLinkedRun(ALICE, "2026-09-10", "30");
    const b = await seedLinkedRun(ALICE, "2026-09-11", "31");
    const base = { userId: ALICE, samples: null, attempts: 0, lastError: null };
    await storage.sessionStreams.upsertResult({ ...base, workoutLogId: a.id, stravaActivityId: "30", status: "unavailable" });
    await storage.sessionStreams.upsertResult({ ...base, workoutLogId: b.id, stravaActivityId: "31", status: "skipped" });

    expect(await storage.sessionStreams.countAttemptsSince(new Date(Date.now() - 60_000))).toBe(1);
    expect(await storage.sessionStreams.countAttemptsSince(new Date(Date.now() + 60_000))).toBe(0);
  });

  it("lists athletes with pending streams only while their Strava connection works", async () => {
    await seedLinkedRun(ALICE, "2026-09-10", "40");
    await seedLinkedRun(BOB, "2026-09-20", "41");
    await connect(ALICE);
    await connect(BOB, true);

    expect(await storage.sessionStreams.listUsersWithPendingStreams(WINDOW)).toEqual([ALICE]);
  });

  it("clears only a skipped verdict, purges on disconnect, and cascades with the log", async () => {
    const skipped = await seedLinkedRun(ALICE, "2026-09-10", "50");
    const fetched = await seedLinkedRun(ALICE, "2026-09-11", "51");
    const base = { userId: ALICE, samples: null, attempts: 0, lastError: null };
    await storage.sessionStreams.upsertResult({ ...base, workoutLogId: skipped.id, stravaActivityId: "50", status: "skipped" });
    await storage.sessionStreams.upsertResult({ ...base, workoutLogId: fetched.id, stravaActivityId: "51", status: "ok", samples: SAMPLES });

    await storage.sessionStreams.clearSkippedForLog(skipped.id, ALICE);
    await storage.sessionStreams.clearSkippedForLog(fetched.id, ALICE);
    const afterClear = await storage.sessionStreams.getForLogs(ALICE, [skipped.id, fetched.id]);
    expect([...afterClear.keys()]).toEqual([fetched.id]);

    await storage.sessionStreams.deleteForLog(fetched.id, BOB);
    expect((await storage.sessionStreams.getForLogs(ALICE, [fetched.id])).size).toBe(1);

    await storage.workouts.deleteWorkoutLog(fetched.id, ALICE);
    expect(await db.select().from(workoutLogStreams)).toHaveLength(0);

    const again = await seedLinkedRun(ALICE, "2026-09-12", "52");
    await storage.sessionStreams.upsertResult({ ...base, workoutLogId: again.id, stravaActivityId: "52", status: "ok", samples: SAMPLES });
    await storage.sessionStreams.deleteForUser(ALICE);
    expect(await db.select().from(workoutLogStreams)).toHaveLength(0);
  });
});

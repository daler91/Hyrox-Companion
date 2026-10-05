import { planDays, trainingPlans, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { storage } from "../../storage";
import {
  resetIntegrationDb,
  seedUser,
  seedWorkoutLog,
} from "../../storage/__tests__/integrationDb";
import { assembleTrainingOverview } from "../trainingOverviewLoader";

/**
 * "All time" adherence against the REAL schema. The athlete did the first four
 * sessions of a seven-session block in full, then stopped logging while the
 * plan ran on. With no range selected the window used to end at the last log,
 * so the three sessions missed after it were never due and the athlete read
 * 100%; the true figure is 400 / 7 ≈ 57%, which is what the ranged view
 * already showed (C37, CODEBASE_ANALYSIS_2026-10-03).
 */
describe("assembleTrainingOverview all-time adherence (real Postgres)", () => {
  const ALICE = "overview-adherence-alice";

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 23:30 UTC on the 29th is already the 30th in Sydney, the athlete's today.
    vi.setSystemTime(new Date("2026-06-29T23:30:00Z"));
    await resetIntegrationDb();
    await seedUser(ALICE);
    await db.update(users).set({ userTimezone: "Australia/Sydney" }).where(eq(users.id, ALICE));

    const [plan] = await db
      .insert(trainingPlans)
      .values({
        userId: ALICE,
        name: "Block",
        totalWeeks: 3,
        startDate: "2026-06-01",
        endDate: "2026-06-21",
      })
      .returning();
    const day = (scheduledDate: string, status: string) => ({
      planId: plan.id,
      weekNumber: 1,
      dayName: "Monday",
      focus: "Strength",
      mainWorkout: "Squats",
      scheduledDate,
      status,
    });
    const done = await db
      .insert(planDays)
      .values([
        day("2026-06-01", "completed"),
        day("2026-06-03", "completed"),
        day("2026-06-05", "completed"),
        day("2026-06-08", "completed"),
      ])
      .returning();
    // The sessions after the last log: two the nightly sweep marked missed and
    // one, long past, it has not reached yet.
    await db
      .insert(planDays)
      .values([
        day("2026-06-10", "missed"),
        day("2026-06-12", "missed"),
        day("2026-06-15", "planned"),
      ]);
    for (const planDay of done) {
      await seedWorkoutLog(ALICE, planDay.scheduledDate!, {
        planDayId: planDay.id,
        planId: plan.id,
        compliancePct: 100,
      });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("counts the sessions missed after the last log, up to the athlete's today", async () => {
    const dueCount = vi.spyOn(storage.analytics, "getDueSessionCount");

    const overview = await assembleTrainingOverview(ALICE);

    expect(overview.currentStats.avgCompliancePct).toBe(57);
    // From the first log to Sydney's today, not to the last log (06-08) nor
    // to the server's UTC date.
    expect(dueCount).toHaveBeenCalledWith(ALICE, "2026-06-01", "2026-06-30", expect.any(String));
    dueCount.mockRestore();
  });

  it("agrees with the ranged view over the same days", async () => {
    const ranged = await assembleTrainingOverview(ALICE, "2026-06-01", "2026-06-30");

    expect(ranged.currentStats.avgCompliancePct).toBe(57);
  });
});

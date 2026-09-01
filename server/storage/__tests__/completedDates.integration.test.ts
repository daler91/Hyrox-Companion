import { planDays, trainingPlans } from "@shared/schema";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../index";
import { resetIntegrationDb, seedUser, seedWorkoutLog } from "./integrationDb";

/**
 * getCompletedWorkoutDates against the REAL schema. It replaces "hydrate the
 * whole timeline and keep the completed dates" for the weekly email's streak,
 * so it must return exactly the dates getTimeline would have marked completed:
 * every logged workout, every completed plan day inside its plan's lifetime —
 * and nothing from another athlete, a retired plan's cutoff onward, or a plan
 * day that is merely planned/missed/skipped.
 */
describe("TimelineStorage.getCompletedWorkoutDates (real Postgres)", () => {
  const ALICE = "completed-alice";
  const BOB = "completed-bob";

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE);
    await seedUser(BOB);

    const [live] = await db
      .insert(trainingPlans)
      .values({ userId: ALICE, name: "Live block", totalWeeks: 1, startDate: "2026-05-04", endDate: "2026-05-10" })
      .returning();
    const [retired] = await db
      .insert(trainingPlans)
      .values({
        userId: ALICE,
        name: "Retired block",
        totalWeeks: 1,
        startDate: "2026-04-27",
        endDate: "2026-05-03",
        retiredOn: "2026-05-01",
      })
      .returning();
    await db.insert(planDays).values([
      // Completed plan day with no linked log: counts on its own.
      { planId: live.id, weekNumber: 1, dayName: "Monday", focus: "Strength", mainWorkout: "Squats", scheduledDate: "2026-05-04", status: "completed" },
      // Planned / missed / skipped days never count.
      { planId: live.id, weekNumber: 1, dayName: "Tuesday", focus: "Run", mainWorkout: "Easy", scheduledDate: "2026-05-05", status: "planned" },
      { planId: live.id, weekNumber: 1, dayName: "Wednesday", focus: "Run", mainWorkout: "Tempo", scheduledDate: "2026-05-06", status: "missed" },
      { planId: live.id, weekNumber: 1, dayName: "Thursday", focus: "Rest", mainWorkout: "Off", scheduledDate: "2026-05-07", status: "skipped" },
      // Retired plan: a completed day BEFORE the cutoff still counts, one AT or
      // AFTER it is outside the plan's lifetime and does not.
      { planId: retired.id, weekNumber: 1, dayName: "Wednesday", focus: "Sled", mainWorkout: "Push", scheduledDate: "2026-04-29", status: "completed" },
      { planId: retired.id, weekNumber: 1, dayName: "Saturday", focus: "Sled", mainWorkout: "Pull", scheduledDate: "2026-05-02", status: "completed" },
    ]);

    // Standalone logs, including two on the same day (must dedupe).
    await seedWorkoutLog(ALICE, "2026-05-01");
    await seedWorkoutLog(ALICE, "2026-05-09");
    await seedWorkoutLog(ALICE, "2026-05-09", { focus: "Second session" });

    // Another athlete's completed day and log must never surface for Alice.
    const [bobPlan] = await db
      .insert(trainingPlans)
      .values({ userId: BOB, name: "Bob's block", totalWeeks: 1, startDate: "2026-05-04", endDate: "2026-05-10" })
      .returning();
    await db.insert(planDays).values({ planId: bobPlan.id, weekNumber: 1, dayName: "Friday", focus: "Run", mainWorkout: "10k", scheduledDate: "2026-05-08", status: "completed" });
    await seedWorkoutLog(BOB, "2026-05-10");
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("returns the distinct dates of logged workouts and completed in-lifetime plan days", async () => {
    const dates = await storage.timeline.getCompletedWorkoutDates(ALICE);
    expect([...dates].sort()).toEqual(["2026-04-29", "2026-05-01", "2026-05-04", "2026-05-09"]);
  });

  it("matches what the full timeline reports as completed", async () => {
    const timeline = await storage.timeline.getTimeline(ALICE);
    const fromTimeline = new Set(timeline.filter((e) => e.status === "completed").map((e) => e.date));
    const slim = await storage.timeline.getCompletedWorkoutDates(ALICE);
    expect([...slim].sort()).toEqual([...fromTimeline].sort());
  });

  it("is empty for an athlete with no plans and no logs", async () => {
    await seedUser("completed-nobody");
    expect((await storage.timeline.getCompletedWorkoutDates("completed-nobody")).size).toBe(0);
  });
});

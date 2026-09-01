import { planDays, trainingPlans } from "@shared/schema";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../index";
import { resetIntegrationDb, seedExerciseSet, seedUser, seedWorkoutLog } from "./integrationDb";

/**
 * getTimeline against the REAL schema. The timeline is a three-source merge
 * (plan days, plan-linked logs, standalone logs) that is over-fetched per
 * source, merged, date-sorted, windowed and only THEN hydrated — the primary
 * loader behind every Timeline page load and every AI coach turn. The unit
 * tests pin the merge on a mocked db; this pins that the SQL actually returns
 * the right rows for the right athlete, in order, windowed, hydrated.
 */
describe("TimelineStorage.getTimeline (real Postgres)", () => {
  const ALICE = "timeline-alice";
  const BOB = "timeline-bob";

  let linkedPlanDayId: string;
  let linkedLogId: string;
  let hydratedLogId: string;

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE);
    await seedUser(BOB);

    const [plan] = await db
      .insert(trainingPlans)
      .values({ userId: ALICE, name: "Alice's block", totalWeeks: 1, startDate: "2026-05-04", endDate: "2026-05-10" })
      .returning();
    const days = await db
      .insert(planDays)
      .values([
        { planId: plan.id, weekNumber: 1, dayName: "Monday", focus: "Strength", mainWorkout: "Squats", scheduledDate: "2026-05-04" },
        { planId: plan.id, weekNumber: 1, dayName: "Wednesday", focus: "Intervals", mainWorkout: "8x400m", scheduledDate: "2026-05-06" },
        { planId: plan.id, weekNumber: 1, dayName: "Friday", focus: "Sled", mainWorkout: "Sled push", scheduledDate: "2026-05-08" },
      ])
      .returning();
    linkedPlanDayId = days[0].id;

    // The Monday session was logged against its plan day.
    const linked = await seedWorkoutLog(ALICE, "2026-05-04", { planDayId: linkedPlanDayId, planId: plan.id });
    linkedLogId = linked.id;
    // Standalone sessions, one of them with structured sets to hydrate.
    await seedWorkoutLog(ALICE, "2026-05-01");
    await seedWorkoutLog(ALICE, "2026-05-05");
    const hydrated = await seedWorkoutLog(ALICE, "2026-05-07");
    hydratedLogId = hydrated.id;
    await seedExerciseSet({ workoutLogId: hydrated.id, exerciseName: "back_squat", category: "strength", setNumber: 1, reps: 5, weight: 100 });
    await seedExerciseSet({ workoutLogId: hydrated.id, exerciseName: "back_squat", category: "strength", setNumber: 2, reps: 5, weight: 105 });

    // Another athlete's session on the same day — must never surface for Alice.
    await seedWorkoutLog(BOB, "2026-05-07", { focus: "Bob's run", mainWorkout: "10k" });
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("merges the three sources for ONE athlete, newest first, with a plan-linked log appearing once", async () => {
    const entries = await storage.timeline.getTimeline(ALICE);

    expect(entries.map((e) => e.date)).toEqual([
      "2026-05-08",
      "2026-05-07",
      "2026-05-06",
      "2026-05-05",
      "2026-05-04",
      "2026-05-01",
    ]);
    expect(entries.some((e) => e.focus === "Bob's run")).toBe(false);

    const monday = entries.filter((e) => e.date === "2026-05-04");
    expect(monday).toHaveLength(1);
    expect(monday[0]).toMatchObject({ type: "logged", workoutLogId: linkedLogId, planDayId: linkedPlanDayId });

    expect(entries.find((e) => e.date === "2026-05-08")).toMatchObject({ type: "planned" });
  });

  it("windows the merged, sorted list with limit/offset", async () => {
    const firstPage = await storage.timeline.getTimeline(ALICE, undefined, 2, 0);
    const secondPage = await storage.timeline.getTimeline(ALICE, undefined, 2, 2);
    const tail = await storage.timeline.getTimeline(ALICE, undefined, 10, 4);

    expect(firstPage.map((e) => e.date)).toEqual(["2026-05-08", "2026-05-07"]);
    expect(secondPage.map((e) => e.date)).toEqual(["2026-05-06", "2026-05-05"]);
    expect(tail.map((e) => e.date)).toEqual(["2026-05-04", "2026-05-01"]);
  });

  it("hydrates exercise sets onto the windowed entries", async () => {
    const [, hydratedEntry] = await storage.timeline.getTimeline(ALICE, undefined, 2, 0);

    expect(hydratedEntry).toMatchObject({ date: "2026-05-07", workoutLogId: hydratedLogId });
    expect(hydratedEntry.exerciseSets?.map((s) => s.weight)).toEqual([100, 105]);

    // The unbounded (export / email digest) call hydrates everything too.
    const all = await storage.timeline.getTimeline(ALICE);
    expect(all.find((e) => e.workoutLogId === hydratedLogId)?.exerciseSets).toHaveLength(2);
  });

  it("returns nothing for an athlete with no history", async () => {
    await seedUser("timeline-nobody");

    expect(await storage.timeline.getTimeline("timeline-nobody")).toEqual([]);
  });
});

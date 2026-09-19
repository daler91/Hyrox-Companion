import {
  exerciseSets,
  mafWorkoutAnalysis,
  planDays,
  recycleBinItems,
  trainingPlans,
  users,
  workoutLogs,
  workoutStructureBlocks,
  workoutStructureSteps,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { bulkDeleteWorkouts } from "../../services/bulkDeleteWorkouts";
import { storage } from "../index";
import { resetIntegrationDb, seedExerciseSet, seedUser, seedWorkoutLog } from "./integrationDb";

/**
 * The recycle bin against the REAL schema: capture inside the delete
 * transaction, restore with the original ids, and every re-link the delete
 * cascades undo (plan-day ↔ workout, MAF analysis ↔ workout, plan-day status).
 * The mocked-db unit tests next door prove the control flow; only this proves
 * the SQL, the jsonb round trip of timestamps, and the FK ordering.
 */
describe("RecycleBinStorage (real Postgres)", () => {
  const ALICE = "bin-alice";
  const BOB = "bin-bob";

  async function seedPlan(userId: string, name = "Build") {
    const [plan] = await db
      .insert(trainingPlans)
      .values({ userId, name, totalWeeks: 4, startDate: "2026-06-01", endDate: "2026-06-28" })
      .returning();
    const [day] = await db
      .insert(planDays)
      .values({
        planId: plan.id,
        weekNumber: 1,
        dayName: "monday",
        focus: "Strength",
        mainWorkout: "5x5 Back Squat",
        scheduledDate: "2026-06-01",
        status: "planned",
        aiNoteUpdatedAt: new Date("2026-05-30T08:00:00.000Z"),
      })
      .returning();
    return { plan, day };
  }

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE);
    await seedUser(BOB);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("round-trips a workout: same ids, sets, structure, MAF link and plan-day status come back", async () => {
    const { plan, day } = await seedPlan(ALICE);
    const log = await seedWorkoutLog(ALICE, "2026-06-01", {
      planId: plan.id,
      planDayId: day.id,
      startedAt: new Date("2026-06-01T06:30:00.000Z"),
      notes: "felt strong",
    });
    await db.update(planDays).set({ status: "completed" }).where(eq(planDays.id, day.id));
    const set = await seedExerciseSet({
      workoutLogId: log.id,
      exerciseName: "Back Squat",
      category: "strength",
      setNumber: 1,
      reps: 5,
      weight: 100,
      weightUnit: "kg",
    });
    const [block] = await db
      .insert(workoutStructureBlocks)
      .values({
        workoutLogId: log.id,
        sectionType: "main",
        formatType: "straight_sets",
        sortOrder: 0,
      })
      .returning();
    const [step] = await db
      .insert(workoutStructureSteps)
      .values({
        blockId: block.id,
        stepNumber: 1,
        stepType: "work",
        exerciseName: "Back Squat",
        targetReps: 5,
      })
      .returning();
    const [analysis] = await db
      .insert(mafWorkoutAnalysis)
      .values({ userId: ALICE, workoutLogId: log.id, compliancePct: 90 })
      .returning();

    const deleted = await storage.workouts.deleteWorkoutLog(log.id, ALICE);
    expect(deleted).not.toBeNull();

    // Gone from the live tables, sitting in the bin with the listing columns filled.
    expect(await db.select().from(workoutLogs).where(eq(workoutLogs.id, log.id))).toHaveLength(0);
    expect(await db.select().from(exerciseSets).where(eq(exerciseSets.id, set.id))).toHaveLength(0);
    const [unlinked] = await db
      .select()
      .from(mafWorkoutAnalysis)
      .where(eq(mafWorkoutAnalysis.id, analysis.id));
    expect(unlinked.workoutLogId).toBeNull();
    const [dayAfterDelete] = await db.select().from(planDays).where(eq(planDays.id, day.id));
    expect(dayAfterDelete.status).toBe("planned");

    const listed = await storage.recycleBin.list(ALICE);
    expect(listed.counts).toEqual({ total: 1, workout_log: 1, plan_day: 0, training_plan: 0 });
    expect(listed.items[0]).toMatchObject({
      id: deleted?.recycleBinItemId,
      entityType: "workout_log",
      entityId: log.id,
      label: "Strength",
      summary: "5x5 Back Squat",
      entityDate: "2026-06-01",
      childCount: 1,
    });

    const restored = await storage.recycleBin.restore(ALICE, deleted!.recycleBinItemId);
    expect(restored).toEqual({
      ok: true,
      entityType: "workout_log",
      entityId: log.id,
      batchId: null,
      warnings: [],
    });

    const [logBack] = await db.select().from(workoutLogs).where(eq(workoutLogs.id, log.id));
    expect(logBack).toMatchObject({
      id: log.id,
      planId: plan.id,
      planDayId: day.id,
      notes: "felt strong",
    });
    expect(logBack.startedAt?.toISOString()).toBe("2026-06-01T06:30:00.000Z"); // jsonb → Date revived
    const [setBack] = await db.select().from(exerciseSets).where(eq(exerciseSets.id, set.id));
    expect(setBack).toMatchObject({ workoutLogId: log.id, reps: 5, weight: 100, weightUnit: "kg" });
    expect(
      await db.select().from(workoutStructureBlocks).where(eq(workoutStructureBlocks.id, block.id)),
    ).toHaveLength(1);
    expect(
      await db.select().from(workoutStructureSteps).where(eq(workoutStructureSteps.id, step.id)),
    ).toHaveLength(1);
    const [relinked] = await db
      .select()
      .from(mafWorkoutAnalysis)
      .where(eq(mafWorkoutAnalysis.id, analysis.id));
    expect(relinked.workoutLogId).toBe(log.id);
    const [dayAfterRestore] = await db.select().from(planDays).where(eq(planDays.id, day.id));
    expect(dayAfterRestore.status).toBe("completed");
    expect(
      await db.select().from(recycleBinItems).where(eq(recycleBinItems.userId, ALICE)),
    ).toHaveLength(0);
  });

  it("restores a workout whose plan day has since been deleted as unplanned, with a warning", async () => {
    const { day } = await seedPlan(ALICE);
    const log = await seedWorkoutLog(ALICE, "2026-06-01", { planDayId: day.id });
    const deleted = await storage.workouts.deleteWorkoutLog(log.id, ALICE);
    await db.delete(planDays).where(eq(planDays.id, day.id));

    const restored = await storage.recycleBin.restore(ALICE, deleted!.recycleBinItemId);

    expect(restored.ok).toBe(true);
    expect(restored.ok && restored.warnings).toEqual([
      "The plan day this workout belonged to no longer exists, so it was restored as an unplanned workout.",
    ]);
    const [logBack] = await db.select().from(workoutLogs).where(eq(workoutLogs.id, log.id));
    expect(logBack.planDayId).toBeNull();
  });

  it("restores a plan day, re-linking the workout its delete unlinked and re-deriving its status", async () => {
    const { plan, day } = await seedPlan(ALICE);
    const log = await seedWorkoutLog(ALICE, "2026-06-01", { planId: plan.id, planDayId: day.id });
    await seedExerciseSet({
      planDayId: day.id,
      exerciseName: "Back Squat",
      category: "strength",
      setNumber: 1,
      reps: 5,
    });

    const deleted = await storage.plans.deletePlanDay(day.id, ALICE);
    expect(deleted).not.toBeNull();
    const [logAfterDelete] = await db.select().from(workoutLogs).where(eq(workoutLogs.id, log.id));
    expect(logAfterDelete.planDayId).toBeNull(); // SET NULL did its job; the log survived

    const restored = await storage.recycleBin.restore(ALICE, deleted!.recycleBinItemId);

    expect(restored).toMatchObject({ ok: true, entityType: "plan_day", entityId: day.id });
    const [dayBack] = await db.select().from(planDays).where(eq(planDays.id, day.id));
    expect(dayBack).toMatchObject({ id: day.id, planId: plan.id, status: "completed" });
    expect(dayBack.aiNoteUpdatedAt?.toISOString()).toBe("2026-05-30T08:00:00.000Z");
    const [logBack] = await db.select().from(workoutLogs).where(eq(workoutLogs.id, log.id));
    expect(logBack).toMatchObject({ planDayId: day.id, planId: plan.id });
    expect(
      await db.select().from(exerciseSets).where(eq(exerciseSets.planDayId, day.id)),
    ).toHaveLength(1);
  });

  it("refuses to restore a plan day whose plan is gone, and a second restore of the same item", async () => {
    const { plan, day } = await seedPlan(ALICE);
    const deletedDay = await storage.plans.deletePlanDay(day.id, ALICE);
    await db.delete(trainingPlans).where(eq(trainingPlans.id, plan.id));

    const refused = await storage.recycleBin.restore(ALICE, deletedDay!.recycleBinItemId);
    expect(refused).toEqual({
      ok: false,
      reason: "not_found",
      message: "The training plan this day belonged to has been deleted. Restore the plan first.",
    });
    // A refused restore rolls back and leaves the item in the bin.
    expect(await storage.recycleBin.get(ALICE, deletedDay!.recycleBinItemId)).toBeDefined();
  });

  it("restores a whole plan with its days and re-links the logs that pointed at it", async () => {
    const { plan, day } = await seedPlan(ALICE);
    const linked = await seedWorkoutLog(ALICE, "2026-06-01", {
      planId: plan.id,
      planDayId: day.id,
    });
    const planOnly = await seedWorkoutLog(ALICE, "2026-06-03", { planId: plan.id });

    const deleted = await storage.plans.deleteTrainingPlan(plan.id, ALICE);
    expect(deleted).not.toBeNull();
    expect(await db.select().from(planDays).where(eq(planDays.planId, plan.id))).toHaveLength(0);
    const listed = await storage.recycleBin.list(ALICE);
    expect(listed.items[0]).toMatchObject({
      entityType: "training_plan",
      label: "Build",
      summary: "1 day · 4 weeks",
      childCount: 1,
    });

    const restored = await storage.recycleBin.restore(ALICE, deleted!.recycleBinItemId);
    expect(restored).toMatchObject({ ok: true, entityType: "training_plan", entityId: plan.id });

    expect(await db.select().from(trainingPlans).where(eq(trainingPlans.id, plan.id))).toHaveLength(
      1,
    );
    const [dayBack] = await db.select().from(planDays).where(eq(planDays.id, day.id));
    expect(dayBack.status).toBe("completed");
    const [linkedBack] = await db.select().from(workoutLogs).where(eq(workoutLogs.id, linked.id));
    expect(linkedBack).toMatchObject({ planId: plan.id, planDayId: day.id });
    const [planOnlyBack] = await db
      .select()
      .from(workoutLogs)
      .where(eq(workoutLogs.id, planOnly.id));
    expect(planOnlyBack).toMatchObject({ planId: plan.id, planDayId: null });

    expect(await storage.recycleBin.restore(ALICE, deleted!.recycleBinItemId)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });

  it("bulk delete bins every target under one batch, and the batch restores all-or-nothing", async () => {
    const { plan, day } = await seedPlan(ALICE);
    const w1 = await seedWorkoutLog(ALICE, "2026-06-02");
    const w2 = await seedWorkoutLog(ALICE, "2026-06-03");

    const result = await bulkDeleteWorkouts({
      userId: ALICE,
      workoutLogIds: [w1.id, w2.id],
      planDayIds: [day.id],
    });
    expect(result.recycleBinItemIds).toHaveLength(3);
    const binned = await db
      .select()
      .from(recycleBinItems)
      .where(eq(recycleBinItems.batchId, result.batchId));
    expect(binned).toHaveLength(3);

    // Knock the plan out from under the plan-day item: the batch must roll back whole.
    await db.delete(trainingPlans).where(eq(trainingPlans.id, plan.id));
    const refused = await storage.recycleBin.restoreBatch(ALICE, result.batchId);
    expect(refused).toMatchObject({ ok: false, reason: "not_found" });
    expect(await db.select().from(workoutLogs).where(eq(workoutLogs.userId, ALICE))).toHaveLength(
      0,
    );
    expect(
      await db.select().from(recycleBinItems).where(eq(recycleBinItems.batchId, result.batchId)),
    ).toHaveLength(3);

    // Purge the now-orphaned day item; the two workouts restore together.
    const dayItem = binned.find((row) => row.entityType === "plan_day")!;
    expect(await storage.recycleBin.purgeItem(ALICE, dayItem.id)).toBe(true);
    const restored = await storage.recycleBin.restoreBatch(ALICE, result.batchId);
    expect(restored).toMatchObject({ ok: true, batchId: result.batchId, warnings: [] });
    expect(restored.ok && restored.restored.map((r) => r.entityId).sort()).toEqual(
      [w1.id, w2.id].sort(),
    );
    expect(await db.select().from(workoutLogs).where(eq(workoutLogs.userId, ALICE))).toHaveLength(
      2,
    );
    expect(
      await db.select().from(recycleBinItems).where(eq(recycleBinItems.batchId, result.batchId)),
    ).toHaveLength(0);
  });

  it("keeps a binned device activity out of the sync's dedupe until it expires or is purged", async () => {
    const log = await seedWorkoutLog(ALICE, "2026-06-05", {
      source: "strava",
      stravaActivityId: "strava-42",
    });
    const deleted = await storage.workouts.deleteWorkoutLog(log.id, ALICE);

    expect(
      await storage.workouts.getExistingStravaActivityIds(ALICE, ["strava-42", "strava-99"]),
    ).toEqual(["strava-42"]);
    expect(await storage.workouts.getExistingStravaActivityIds(BOB, ["strava-42"])).toEqual([]);

    // Expired → no longer counted, hidden from the listing, and swept by the purge.
    await db
      .update(recycleBinItems)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(recycleBinItems.id, deleted!.recycleBinItemId));
    expect(await storage.workouts.getExistingStravaActivityIds(ALICE, ["strava-42"])).toEqual([]);
    expect((await storage.recycleBin.list(ALICE)).items).toHaveLength(0);
    expect(await storage.recycleBin.get(ALICE, deleted!.recycleBinItemId)).toBeUndefined();
    expect(await storage.recycleBin.restore(ALICE, deleted!.recycleBinItemId)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect(await storage.recycleBin.purgeExpired()).toBe(1);
  });

  it("refuses to restore a device workout whose activity was imported again meanwhile", async () => {
    const log = await seedWorkoutLog(ALICE, "2026-06-05", {
      source: "strava",
      stravaActivityId: "strava-7",
    });
    const deleted = await storage.workouts.deleteWorkoutLog(log.id, ALICE);
    await seedWorkoutLog(ALICE, "2026-06-05", { source: "strava", stravaActivityId: "strava-7" }); // the race

    const refused = await storage.recycleBin.restore(ALICE, deleted!.recycleBinItemId);

    expect(refused).toMatchObject({ ok: false, reason: "device_activity_reimported" });
    expect(await storage.recycleBin.get(ALICE, deleted!.recycleBinItemId)).toBeDefined();
  });

  it("isolates users, and the bin leaves with the account", async () => {
    const log = await seedWorkoutLog(ALICE, "2026-06-06");
    const deleted = await storage.workouts.deleteWorkoutLog(log.id, ALICE);

    expect((await storage.recycleBin.list(BOB)).items).toHaveLength(0);
    expect(await storage.recycleBin.get(BOB, deleted!.recycleBinItemId)).toBeUndefined();
    expect(await storage.recycleBin.restore(BOB, deleted!.recycleBinItemId)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect(await storage.recycleBin.purgeItem(BOB, deleted!.recycleBinItemId)).toBe(false);
    expect(await storage.recycleBin.emptyBin(BOB)).toBe(0);
    expect(await storage.recycleBin.get(ALICE, deleted!.recycleBinItemId)).toBeDefined();

    await db.delete(users).where(eq(users.id, ALICE));
    expect(
      await db.select().from(recycleBinItems).where(eq(recycleBinItems.userId, ALICE)),
    ).toHaveLength(0);
  });
});

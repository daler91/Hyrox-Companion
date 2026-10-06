import { exerciseSets, planDays, trainingPlans } from "@shared/schema";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { AppError } from "../../errors";
import { storage } from "../index";
import { resetIntegrationDb, seedExerciseSet, seedUser, seedWorkoutLog } from "./integrationDb";

/**
 * The one-request set order save (PF5, CODEBASE_ANALYSIS_2026-10-03) against
 * the real schema: the ownership lock, the "every set exactly once" check and
 * the CASE update that writes each position, end to end.
 */
describe("WorkoutStorage.mutateExerciseSetOrder (real Postgres)", () => {
  const ALICE = "order-alice";
  const BOB = "order-bob";
  const NAMES = ["back_squat", "deadlift", "bench_press", "pull_up"];

  let logId: string;
  let setIds: string[];

  async function seedSets(owner: { workoutLogId?: string; planDayId?: string }): Promise<string[]> {
    const rows = await Promise.all(
      NAMES.map((exerciseName, sortOrder) =>
        seedExerciseSet({
          ...owner,
          exerciseName,
          category: "strength",
          setNumber: 1,
          reps: 5,
          sortOrder,
        }),
      ),
    );
    return rows.map((row) => row.id);
  }

  function readOrder(where: ReturnType<typeof eq>) {
    return db
      .select({
        id: exerciseSets.id,
        sortOrder: exerciseSets.sortOrder,
        version: exerciseSets.version,
      })
      .from(exerciseSets)
      .where(where)
      .orderBy(asc(exerciseSets.sortOrder));
  }

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE);
    await seedUser(BOB);
    const log = await seedWorkoutLog(ALICE, "2026-09-01");
    logId = log.id;
    setIds = await seedSets({ workoutLogId: log.id });
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("writes every set's position in one save and leaves versions alone", async () => {
    const [squat, deadlift, bench, pullUp] = setIds;
    const next = [bench, pullUp, squat, deadlift];

    const saved = await storage.workouts.mutateExerciseSetOrder(
      { kind: "workoutLog", ownerId: logId },
      next,
      ALICE,
    );

    expect(saved?.map((set) => set.id)).toEqual(next);
    expect(saved?.map((set) => set.sortOrder)).toEqual([0, 1, 2, 3]);
    const stored = await readOrder(eq(exerciseSets.workoutLogId, logId));
    expect(stored.map((row) => row.id)).toEqual(next);
    // A new position overwrites no value, so a cell edit's lock still holds.
    expect(stored.map((row) => row.version)).toEqual([1, 1, 1, 1]);
  });

  it("refuses another athlete's workout and writes nothing", async () => {
    const reversed = [...setIds].reverse();

    const saved = await storage.workouts.mutateExerciseSetOrder(
      { kind: "workoutLog", ownerId: logId },
      reversed,
      BOB,
    );

    expect(saved).toBeUndefined();
    expect((await readOrder(eq(exerciseSets.workoutLogId, logId))).map((row) => row.id)).toEqual(
      setIds,
    );
  });

  it.each([
    ["leaves a set out", (ids: string[]) => ids.slice(1)],
    [
      "names a set from another workout",
      (ids: string[], foreign: string) => [...ids.slice(1), foreign],
    ],
  ])("refuses a list that %s with 409, and writes nothing", async (_label, build) => {
    const otherLog = await seedWorkoutLog(ALICE, "2026-09-02");
    const [foreign] = await seedSets({ workoutLogId: otherLog.id });
    const list = build([...setIds].reverse(), foreign);

    const attempt = storage.workouts.mutateExerciseSetOrder(
      { kind: "workoutLog", ownerId: logId },
      list,
      ALICE,
    );

    await expect(attempt).rejects.toBeInstanceOf(AppError);
    await expect(attempt).rejects.toMatchObject({ status: 409 });
    expect((await readOrder(eq(exerciseSets.workoutLogId, logId))).map((row) => row.id)).toEqual(
      setIds,
    );
  });

  it("orders a plan day's sets through the plan's owner and leaves other days alone", async () => {
    const [plan] = await db
      .insert(trainingPlans)
      .values({ userId: ALICE, name: "Block", totalWeeks: 4 })
      .returning();
    const [monday, tuesday] = await db
      .insert(planDays)
      .values([
        {
          planId: plan.id,
          weekNumber: 1,
          dayName: "Monday",
          focus: "Strength",
          mainWorkout: "Squats",
        },
        {
          planId: plan.id,
          weekNumber: 1,
          dayName: "Tuesday",
          focus: "Strength",
          mainWorkout: "Pulls",
        },
      ])
      .returning();
    const [mondayIds, tuesdayIds] = await Promise.all([
      seedSets({ planDayId: monday.id }),
      seedSets({ planDayId: tuesday.id }),
    ]);
    const next = [...mondayIds].reverse();

    const byBob = await storage.workouts.mutateExerciseSetOrder(
      { kind: "planDay", ownerId: monday.id },
      next,
      BOB,
    );
    const byAlice = await storage.workouts.mutateExerciseSetOrder(
      { kind: "planDay", ownerId: monday.id },
      next,
      ALICE,
    );

    expect(byBob).toBeUndefined();
    expect(byAlice?.map((set) => set.id)).toEqual(next);
    expect((await readOrder(eq(exerciseSets.planDayId, monday.id))).map((row) => row.id)).toEqual(
      next,
    );
    expect((await readOrder(eq(exerciseSets.planDayId, tuesday.id))).map((row) => row.id)).toEqual(
      tuesdayIds,
    );
  });
});

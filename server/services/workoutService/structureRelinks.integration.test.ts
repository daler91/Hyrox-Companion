import { randomUUID } from "node:crypto";

import {
  exerciseSets,
  planDays,
  type StructureBlockInput,
  type StructureSetRelink,
  trainingPlans,
  users,
  workoutLogs,
  workoutStructureBlocks,
  workoutStructureSteps,
} from "@shared/schema";
import { asc, eq, inArray, or } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { seedExerciseSet, seedUser, seedWorkoutLog } from "../../storage/__tests__/integrationDb";
import { replacePlanDayStructure } from "./structure";
import { updateWorkout } from "./workouts";

/**
 * A block save and the rows that follow its renumbered steps commit together
 * or not at all, against the REAL schema (CL15, CODEBASE_ANALYSIS_2026-10-03).
 * Cleans up only its own athletes: other suites share this database.
 */
const ATHLETE = "structure-relinks-athlete";
const OTHER = "structure-relinks-other";

async function removeAthletes(): Promise<void> {
  const ids = [ATHLETE, OTHER];
  const logs = await db
    .select({ id: workoutLogs.id })
    .from(workoutLogs)
    .where(inArray(workoutLogs.userId, ids));
  const plans = await db
    .select({ id: trainingPlans.id })
    .from(trainingPlans)
    .where(inArray(trainingPlans.userId, ids));
  const days =
    plans.length === 0
      ? []
      : await db
          .select({ id: planDays.id })
          .from(planDays)
          .where(
            inArray(
              planDays.planId,
              plans.map((plan) => plan.id),
            ),
          );
  const owners = [
    ...(logs.length > 0
      ? [
          inArray(
            exerciseSets.workoutLogId,
            logs.map((log) => log.id),
          ),
        ]
      : []),
    ...(days.length > 0
      ? [
          inArray(
            exerciseSets.planDayId,
            days.map((day) => day.id),
          ),
        ]
      : []),
  ];
  if (owners.length > 0) await db.delete(exerciseSets).where(or(...owners));
  await db.delete(workoutLogs).where(inArray(workoutLogs.userId, ids));
  if (plans.length > 0) {
    await db.delete(planDays).where(
      inArray(
        planDays.planId,
        plans.map((plan) => plan.id),
      ),
    );
    await db.delete(trainingPlans).where(inArray(trainingPlans.userId, ids));
  }
  await db.delete(users).where(inArray(users.id, ids));
}

function emom(blockId: string, names: readonly string[]): StructureBlockInput {
  return {
    id: blockId,
    sectionType: "main",
    formatType: "emom",
    durationMinutes: 9,
    sequenceOrder: 0,
    sortOrder: 0,
    steps: names.map((exerciseName, idx) => ({
      stepNumber: idx + 1,
      minuteIndex: idx + 1,
      stepType: "work" as const,
      exerciseName,
    })),
  };
}

async function savedStepNames(
  owner: { workoutLogId: string } | { planDayId: string },
): Promise<(string | null)[]> {
  const ownerCondition =
    "workoutLogId" in owner
      ? eq(workoutStructureBlocks.workoutLogId, owner.workoutLogId)
      : eq(workoutStructureBlocks.planDayId, owner.planDayId);
  const blocks = await db
    .select({ id: workoutStructureBlocks.id })
    .from(workoutStructureBlocks)
    .where(ownerCondition);
  if (blocks.length === 0) return [];
  const steps = await db
    .select({ exerciseName: workoutStructureSteps.exerciseName })
    .from(workoutStructureSteps)
    .where(
      inArray(
        workoutStructureSteps.blockId,
        blocks.map((block) => block.id),
      ),
    )
    .orderBy(asc(workoutStructureSteps.stepNumber));
  return steps.map((step) => step.exerciseName);
}

async function rowLinks(condition: ReturnType<typeof eq>) {
  const rows = await db
    .select({
      exerciseName: exerciseSets.exerciseName,
      blockId: exerciseSets.blockId,
      stepNumber: exerciseSets.stepNumber,
      intervalMinute: exerciseSets.intervalMinute,
    })
    .from(exerciseSets)
    .where(condition)
    .orderBy(asc(exerciseSets.sortOrder));
  return rows.map((row) => [
    row.exerciseName,
    row.blockId === null ? null : "block",
    row.stepNumber,
    row.intervalMinute,
  ]);
}

/** Row ids by exercise name. */
async function rowIds(condition: ReturnType<typeof eq>): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: exerciseSets.id, exerciseName: exerciseSets.exerciseName })
    .from(exerciseSets)
    .where(condition);
  return new Map(rows.map((row) => [row.exerciseName, row.id]));
}

function relinksAfterRemovingFirst(
  blockId: string,
  ids: Map<string, string>,
): StructureSetRelink[] {
  const id = (name: string) => {
    const found = ids.get(name);
    if (!found) throw new Error(`no row for ${name}`);
    return found;
  };
  return [
    {
      setId: id("wall_balls"),
      fromBlockId: blockId,
      fromStepNumber: 1,
      blockId: null,
      stepNumber: null,
    },
    {
      setId: id("burpees"),
      fromBlockId: blockId,
      fromStepNumber: 2,
      blockId,
      stepNumber: 1,
      intervalMinute: 1,
    },
    {
      setId: id("row"),
      fromBlockId: blockId,
      fromStepNumber: 3,
      blockId,
      stepNumber: 2,
      intervalMinute: 2,
    },
  ];
}

describe("structure saves move their rows atomically (real Postgres)", () => {
  beforeEach(async () => {
    await removeAthletes();
    await seedUser(ATHLETE);
    await seedUser(OTHER);
  });

  afterAll(async () => {
    await removeAthletes();
  });

  describe("on a logged workout", () => {
    async function seedLoggedEmom() {
      const blockId = randomUUID();
      const log = await seedWorkoutLog(ATHLETE, "2026-09-10");
      // No rows yet, so the first save derives one per step.
      await updateWorkout(log.id, {}, undefined, ATHLETE, [
        emom(blockId, ["wall_balls", "burpees", "row"]),
      ]);
      const condition = eq(exerciseSets.workoutLogId, log.id);
      return { blockId, log, condition, ids: await rowIds(condition) };
    }

    it("saves the blocks with the rows on their renumbered steps", async () => {
      const { blockId, log, condition, ids } = await seedLoggedEmom();

      await updateWorkout(
        log.id,
        { relinks: relinksAfterRemovingFirst(blockId, ids) },
        undefined,
        ATHLETE,
        [emom(blockId, ["burpees", "row"])],
      );

      expect(await savedStepNames({ workoutLogId: log.id })).toEqual(["burpees", "row"]);
      expect(await rowLinks(condition)).toEqual([
        ["wall_balls", null, null, null],
        ["burpees", "block", 1, 1],
        ["row", "block", 2, 2],
      ]);
    });

    it("writes nothing when one relink names another athlete's set", async () => {
      const { blockId, log, condition, ids } = await seedLoggedEmom();
      const foreignLog = await seedWorkoutLog(OTHER, "2026-09-10");
      const foreign = await seedExerciseSet({
        workoutLogId: foreignLog.id,
        exerciseName: "burpees",
        category: "conditioning",
        setNumber: 1,
        blockId,
        stepNumber: 2,
      });
      const relinks = relinksAfterRemovingFirst(blockId, ids);
      relinks.push({
        setId: foreign.id,
        fromBlockId: blockId,
        fromStepNumber: 2,
        blockId,
        stepNumber: 1,
      });

      await expect(
        updateWorkout(log.id, { relinks }, undefined, ATHLETE, [emom(blockId, ["burpees", "row"])]),
      ).rejects.toMatchObject({ status: 404 });

      expect(await savedStepNames({ workoutLogId: log.id })).toEqual([
        "wall_balls",
        "burpees",
        "row",
      ]);
      expect(await rowLinks(condition)).toEqual([
        ["wall_balls", "block", 1, 1],
        ["burpees", "block", 2, 2],
        ["row", "block", 3, 3],
      ]);
      expect(await rowLinks(eq(exerciseSets.workoutLogId, foreignLog.id))).toEqual([
        ["burpees", "block", 2, null],
      ]);
    });

    it("still saves when a relinked row was deleted after the client computed the relinks", async () => {
      const { blockId, log, condition, ids } = await seedLoggedEmom();
      // The athlete deleted the wall ball row while the block save was pending.
      await db.delete(exerciseSets).where(eq(exerciseSets.id, ids.get("wall_balls") ?? ""));

      await updateWorkout(
        log.id,
        { relinks: relinksAfterRemovingFirst(blockId, ids) },
        undefined,
        ATHLETE,
        [emom(blockId, ["burpees", "row"])],
      );

      expect(await savedStepNames({ workoutLogId: log.id })).toEqual(["burpees", "row"]);
      expect(await rowLinks(condition)).toEqual([
        ["burpees", "block", 1, 1],
        ["row", "block", 2, 2],
      ]);
    });

    it("writes nothing when one relink names a set from another of the athlete's workouts", async () => {
      const { blockId, log, condition, ids } = await seedLoggedEmom();
      const otherLog = await seedWorkoutLog(ATHLETE, "2026-09-11");
      const elsewhere = await seedExerciseSet({
        workoutLogId: otherLog.id,
        exerciseName: "burpees",
        category: "conditioning",
        setNumber: 1,
        blockId,
        stepNumber: 2,
      });
      const relinks = relinksAfterRemovingFirst(blockId, ids);
      relinks.push({
        setId: elsewhere.id,
        fromBlockId: blockId,
        fromStepNumber: 2,
        blockId,
        stepNumber: 1,
      });

      await expect(
        updateWorkout(log.id, { relinks }, undefined, ATHLETE, [emom(blockId, ["burpees", "row"])]),
      ).rejects.toMatchObject({ status: 404 });

      expect(await savedStepNames({ workoutLogId: log.id })).toEqual([
        "wall_balls",
        "burpees",
        "row",
      ]);
      expect(await rowLinks(condition)).toEqual([
        ["wall_balls", "block", 1, 1],
        ["burpees", "block", 2, 2],
        ["row", "block", 3, 3],
      ]);
      expect(await rowLinks(eq(exerciseSets.workoutLogId, otherLog.id))).toEqual([
        ["burpees", "block", 2, null],
      ]);
    });

    it("leaves a row a newer write already moved off the link the relink names", async () => {
      const { blockId, log, condition, ids } = await seedLoggedEmom();
      // The athlete re-assigned Row to step 1 after the client computed the relinks.
      await db
        .update(exerciseSets)
        .set({ stepNumber: 1, intervalMinute: 1 })
        .where(eq(exerciseSets.id, ids.get("row") ?? ""));

      await updateWorkout(
        log.id,
        { relinks: relinksAfterRemovingFirst(blockId, ids) },
        undefined,
        ATHLETE,
        [emom(blockId, ["burpees", "row"])],
      );

      expect((await rowLinks(condition)).find(([name]) => name === "row")).toEqual([
        "row",
        "block",
        1,
        1,
      ]);
    });

    it("runs overlapping saves of one workout one after the other instead of colliding (U3)", async () => {
      const { blockId, log } = await seedLoggedEmom();
      const saves = ["burpees", "row", "ski", "sled_push", "wall_balls"].map((name) =>
        updateWorkout(log.id, {}, undefined, ATHLETE, [emom(blockId, [name])]),
      );

      const results = await Promise.allSettled(saves);

      expect(results.map((result) => result.status)).toEqual(
        Array.from({ length: saves.length }, () => "fulfilled"),
      );
      expect(await savedStepNames({ workoutLogId: log.id })).toHaveLength(1);
    });

    it("refuses relinks without blocks to save, or beside a replacement of every row", async () => {
      const { blockId, log, ids } = await seedLoggedEmom();
      const relinks = relinksAfterRemovingFirst(blockId, ids);

      await expect(updateWorkout(log.id, { relinks }, undefined, ATHLETE)).rejects.toMatchObject({
        status: 400,
      });
      await expect(
        updateWorkout(log.id, { relinks }, [], ATHLETE, [emom(blockId, ["burpees", "row"])]),
      ).rejects.toMatchObject({ status: 400 });
      expect(await savedStepNames({ workoutLogId: log.id })).toEqual([
        "wall_balls",
        "burpees",
        "row",
      ]);
    });
  });

  describe("on a planned day", () => {
    async function seedPlannedEmom(userId = ATHLETE) {
      const blockId = randomUUID();
      const [plan] = await db
        .insert(trainingPlans)
        .values({ userId, name: "Engine block", totalWeeks: 4 })
        .returning();
      const [day] = await db
        .insert(planDays)
        .values({
          planId: plan.id,
          weekNumber: 1,
          dayName: "Monday",
          focus: "Engine",
          mainWorkout: "EMOM 9",
          scheduledDate: "2026-09-14",
        })
        .returning();
      await replacePlanDayStructure(day.id, userId, [
        emom(blockId, ["wall_balls", "burpees", "row"]),
      ]);
      const condition = eq(exerciseSets.planDayId, day.id);
      return { blockId, day, condition, ids: await rowIds(condition) };
    }

    it("saves the blocks with the rows on their renumbered steps", async () => {
      const { blockId, day, condition, ids } = await seedPlannedEmom();

      const saved = await replacePlanDayStructure(
        day.id,
        ATHLETE,
        [emom(blockId, ["burpees", "row"])],
        relinksAfterRemovingFirst(blockId, ids),
      );

      expect(saved?.structureBlocks.at(0)?.steps.map((step) => step.exerciseName)).toEqual([
        "burpees",
        "row",
      ]);
      expect(await rowLinks(condition)).toEqual([
        ["wall_balls", null, null, null],
        ["burpees", "block", 1, 1],
        ["row", "block", 2, 2],
      ]);
    });

    it("writes nothing when one relink names a set from another day", async () => {
      const { blockId, day, condition, ids } = await seedPlannedEmom();
      const other = await seedPlannedEmom(OTHER);
      const relinks = relinksAfterRemovingFirst(blockId, ids);
      relinks.push({
        setId: other.ids.get("burpees") ?? "",
        fromBlockId: other.blockId,
        fromStepNumber: 2,
        blockId: other.blockId,
        stepNumber: 1,
      });

      await expect(
        replacePlanDayStructure(day.id, ATHLETE, [emom(blockId, ["burpees", "row"])], relinks),
      ).rejects.toMatchObject({ status: 404 });

      expect(await savedStepNames({ planDayId: day.id })).toEqual(["wall_balls", "burpees", "row"]);
      expect(await rowLinks(condition)).toEqual([
        ["wall_balls", "block", 1, 1],
        ["burpees", "block", 2, 2],
        ["row", "block", 3, 3],
      ]);
    });

    it("still saves when a relinked row was deleted after the client computed the relinks", async () => {
      const { blockId, day, condition, ids } = await seedPlannedEmom();
      await db.delete(exerciseSets).where(eq(exerciseSets.id, ids.get("wall_balls") ?? ""));

      const saved = await replacePlanDayStructure(
        day.id,
        ATHLETE,
        [emom(blockId, ["burpees", "row"])],
        relinksAfterRemovingFirst(blockId, ids),
      );

      expect(saved?.structureBlocks.at(0)?.steps.map((step) => step.exerciseName)).toEqual([
        "burpees",
        "row",
      ]);
      expect(await rowLinks(condition)).toEqual([
        ["burpees", "block", 1, 1],
        ["row", "block", 2, 2],
      ]);
    });

    it("refuses another athlete's day", async () => {
      const { blockId, day } = await seedPlannedEmom();

      expect(await replacePlanDayStructure(day.id, OTHER, [emom(blockId, ["row"])])).toBeNull();
      expect(await savedStepNames({ planDayId: day.id })).toEqual(["wall_balls", "burpees", "row"]);
    });

    it("runs overlapping saves of one day one after the other instead of colliding (U3)", async () => {
      const { blockId, day } = await seedPlannedEmom();
      // The client re-sends the block's id with every save.
      const saves = ["burpees", "row", "ski", "sled_push", "wall_balls"].map((name) =>
        replacePlanDayStructure(day.id, ATHLETE, [emom(blockId, [name])]),
      );

      const results = await Promise.allSettled(saves);

      expect(results.map((result) => result.status)).toEqual(
        Array.from({ length: saves.length }, () => "fulfilled"),
      );
      expect(await savedStepNames({ planDayId: day.id })).toHaveLength(1);
    });
  });
});

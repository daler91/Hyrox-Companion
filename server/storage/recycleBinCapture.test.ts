import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeQueryBuilderMock } from "./__tests__/queryBuilderMock";
import {
  capturePlanDays,
  captureTrainingPlan,
  captureWorkoutLogs,
  planDayLabel,
  recycleBinExpiryFor,
  summarizeText,
} from "./recycleBinCapture";

// The SQL itself is proven by recycleBin.integration.test.ts against a real
// Postgres; this pins the ownership short-circuits and the denormalised
// listing columns.
const makeTx = () =>
  makeQueryBuilderMock([
    "select",
    "from",
    "where",
    "innerJoin",
    "orderBy",
    "limit",
    "insert",
    "values",
    "onConflictDoUpdate",
    "returning",
  ]);

describe("recycleBinCapture helpers", () => {
  it("expires an item RECYCLE_BIN_RETENTION_DAYS (90) after now", () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    expect(recycleBinExpiryFor(now).toISOString()).toBe("2026-12-18T12:00:00.000Z");
  });

  it("collapses whitespace and truncates a long prescription with an ellipsis", () => {
    expect(summarizeText("  5x5\n\nBack   Squat ")).toBe("5x5 Back Squat");
    expect(summarizeText(null)).toBeNull();
    expect(summarizeText("   \n ")).toBeNull();
    const long = summarizeText("x".repeat(300));
    expect(long).toHaveLength(140);
    expect(long?.endsWith("…")).toBe(true);
  });

  it("labels a plan day by week, day and focus", () => {
    expect(planDayLabel({ weekNumber: 3, dayName: "tuesday", focus: "Intervals" })).toBe(
      "Week 3 · Tuesday · Intervals",
    );
  });
});

describe("captureWorkoutLogs", () => {
  let tx: ReturnType<typeof makeTx>;
  beforeEach(() => {
    tx = makeTx();
  });

  it("does nothing for an empty id list", async () => {
    expect(await captureWorkoutLogs(tx as never, "u1", [])).toEqual(new Map());
    expect(tx.select).not.toHaveBeenCalled();
  });

  it("returns an empty map, and inserts nothing, when none of the logs are the user's", async () => {
    tx.queue([]);
    expect(await captureWorkoutLogs(tx as never, "u1", ["w1"])).toEqual(new Map());
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("snapshots each owned log with its sets, structure and MAF analyses, denormalising the listing columns", async () => {
    const log = {
      id: "w1",
      userId: "u1",
      date: "2026-09-01",
      focus: "Strength",
      mainWorkout: "5x5\nBack Squat",
      stravaActivityId: "s-123",
      garminActivityId: null,
    };
    tx.queue(
      [log], // logs
      [
        { id: "set-1", workoutLogId: "w1" },
        { id: "set-2", workoutLogId: "w1" },
      ], // sets
      [{ id: "b1", workoutLogId: "w1", sortOrder: 0 }], // blocks
      [{ id: "st1", blockId: "b1", stepNumber: 1 }], // steps
      [{ id: "maf-1", workoutLogId: "w1" }], // maf analyses
      [{ id: "rb-1", entityId: "w1" }], // insert … returning
    );

    const now = new Date("2026-09-19T00:00:00.000Z");
    const result = await captureWorkoutLogs(tx as never, "u1", ["w1"], { batchId: "batch-1", now });

    expect(result).toEqual(new Map([["w1", "rb-1"]]));
    expect(tx.values).toHaveBeenCalledTimes(1);
    const [items] = tx.values.mock.calls[0];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      userId: "u1",
      entityType: "workout_log",
      entityId: "w1",
      batchId: "batch-1",
      label: "Strength",
      summary: "5x5 Back Squat",
      entityDate: "2026-09-01",
      childCount: 2,
      stravaActivityId: "s-123",
      garminActivityId: null,
      deletedAt: now,
      expiresAt: new Date("2026-12-18T00:00:00.000Z"),
    });
    expect(items[0].payload).toEqual({
      version: 1,
      kind: "workout_log",
      workout: {
        log,
        exerciseSets: [
          { id: "set-1", workoutLogId: "w1" },
          { id: "set-2", workoutLogId: "w1" },
        ],
        structureBlocks: [
          {
            block: { id: "b1", workoutLogId: "w1", sortOrder: 0 },
            steps: [{ id: "st1", blockId: "b1", stepNumber: 1 }],
          },
        ],
        mafWorkoutAnalysisIds: ["maf-1"],
      },
    });
  });
});

describe("capturePlanDays", () => {
  it("returns an empty map when no day belongs to one of the user's plans", async () => {
    const tx = makeTx();
    tx.queue([]);
    expect(await capturePlanDays(tx as never, "u1", ["d1"])).toEqual(new Map());
    expect(tx.innerJoin).toHaveBeenCalledTimes(1); // ownership goes through training_plans
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("records the logs the delete will unlink so restore can re-link them", async () => {
    const tx = makeTx();
    const day = {
      id: "d1",
      planId: "p1",
      weekNumber: 2,
      dayName: "friday",
      focus: "Engine",
      mainWorkout: "Row 5k",
      scheduledDate: "2026-09-05",
    };
    tx.queue(
      [{ day }], // owned days
      [], // sets
      [], // blocks (no steps query when empty)
      [{ id: "w9", planDayId: "d1" }], // linked logs
      [{ id: "rb-2", entityId: "d1" }], // insert … returning
    );

    expect(await capturePlanDays(tx as never, "u1", ["d1"])).toEqual(new Map([["d1", "rb-2"]]));
    const [items] = tx.values.mock.calls[0];
    expect(items[0]).toMatchObject({
      entityType: "plan_day",
      entityId: "d1",
      label: "Week 2 · Friday · Engine",
      entityDate: "2026-09-05",
      childCount: 0,
      batchId: null,
    });
    expect(items[0].payload.planDay.linkedWorkoutLogIds).toEqual(["w9"]);
  });
});

describe("captureTrainingPlan", () => {
  it("returns undefined without inserting when the plan is not the user's", async () => {
    const tx = makeTx();
    tx.queue([]);
    expect(await captureTrainingPlan(tx as never, "u1", "p1")).toBeUndefined();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("captures the plan, its days and every log that pointed at the plan or a day", async () => {
    const tx = makeTx();
    const plan = {
      id: "p1",
      userId: "u1",
      name: "12-week build",
      totalWeeks: 12,
      startDate: "2026-06-01",
    };
    tx.queue(
      [plan],
      [
        {
          id: "d1",
          planId: "p1",
          weekNumber: 1,
          dayName: "monday",
          focus: "A",
          mainWorkout: "x",
          scheduledDate: "2026-06-01",
        },
      ], // days
      [], // sets
      [], // blocks
      [{ id: "w1", planDayId: "d1" }], // logs linked to days (per-day snapshot)
      [
        { id: "w1", planDayId: "d1" },
        { id: "w2", planDayId: null },
      ], // logs linked to plan or days
      [{ id: "rb-3", entityId: "p1" }], // insert … returning
    );

    expect(await captureTrainingPlan(tx as never, "u1", "p1")).toBe("rb-3");
    const [items] = tx.values.mock.calls[0];
    expect(items[0]).toMatchObject({
      entityType: "training_plan",
      entityId: "p1",
      label: "12-week build",
      summary: "1 day · 12 weeks",
      entityDate: "2026-06-01",
      childCount: 1,
    });
    expect(items[0].payload.linkedWorkoutLogs).toEqual([
      { id: "w1", planDayId: "d1" },
      { id: "w2", planDayId: null },
    ]);
    expect(items[0].payload.days[0].linkedWorkoutLogIds).toEqual(["w1"]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../db";
import { logger } from "../logger";
import { makeExerciseSet } from "../services/ai/testFixtures";
import {
  MAX_WORKOUT_LOGS_PER_QUERY,
  prescribedSetToLogRow,
  queryExerciseSetsWithDates,
  structureTargetsFromExerciseSet,
} from "./shared";

vi.mock("../db", () => ({
  db: { query: { workoutLogs: { findMany: vi.fn() } } },
}));

vi.mock("../logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe("prescribedSetToLogRow", () => {
  it("mirrors a prescribed set's actual values into the planned columns when no planned values exist", () => {
    const prescribed = makeExerciseSet({
      exerciseName: "back_squat",
      reps: 5,
      weight: 100,
      distance: null,
      time: null,
      plannedReps: null,
      plannedWeight: null,
      plannedDistance: null,
      plannedTime: null,
    });

    const row = prescribedSetToLogRow(prescribed, "log-1");

    expect(row.workoutLogId).toBe("log-1");
    expect(row.planDayId).toBeNull();
    expect(row.reps).toBe(5);
    expect(row.plannedReps).toBe(5);
    expect(row.weight).toBe(100);
    expect(row.plannedWeight).toBe(100);
  });

  it("keeps an already-prescribed planned value instead of overwriting it with the actual", () => {
    // A row that already carries its own prescription (e.g. re-copied from a
    // plan day) must not have that prescription clobbered by whatever was
    // actually logged.
    const prescribed = makeExerciseSet({
      reps: 8,
      plannedReps: 5,
      weight: 105,
      plannedWeight: 100,
      distance: 400,
      plannedDistance: 380,
      time: 90,
      plannedTime: 85,
    });

    const row = prescribedSetToLogRow(prescribed, "log-1");

    expect(row.plannedReps).toBe(5);
    expect(row.plannedWeight).toBe(100);
    expect(row.plannedDistance).toBe(380);
    expect(row.plannedTime).toBe(85);
  });

  it("carries the JSON-typed columns and identity fields through unchanged", () => {
    const prescribed = makeExerciseSet({
      blockId: "block-1",
      stepNumber: 2,
      intervalMinute: 3,
      cycleNumber: 1,
      stepRole: "work",
      groupId: "group-1",
      intensity: { rpe: 7 },
      load: { percent1Rm: 80 },
      tempo: { eccentric: 3 },
      standards: { rxWeight: 60 },
      notes: "felt strong",
      confidence: 90,
      sortOrder: 4,
    });

    const row = prescribedSetToLogRow(prescribed, "log-2");

    expect(row.blockId).toBe("block-1");
    expect(row.stepNumber).toBe(2);
    expect(row.intervalMinute).toBe(3);
    expect(row.cycleNumber).toBe(1);
    expect(row.stepRole).toBe("work");
    expect(row.groupId).toBe("group-1");
    expect(row.intensity).toEqual({ rpe: 7 });
    expect(row.load).toEqual({ percent1Rm: 80 });
    expect(row.tempo).toEqual({ eccentric: 3 });
    expect(row.standards).toEqual({ rxWeight: 60 });
    expect(row.notes).toBe("felt strong");
    expect(row.confidence).toBe(90);
    expect(row.sortOrder).toBe(4);
  });
});

describe("structureTargetsFromExerciseSet", () => {
  it("returns null when the row carries no reps/weight/distance/time at all", () => {
    const row = makeExerciseSet();
    expect(structureTargetsFromExerciseSet(row)).toBeNull();
  });

  it("builds only the target keys the row actually has", () => {
    const row = makeExerciseSet({ reps: 10, weight: null, distance: null, time: null });
    expect(structureTargetsFromExerciseSet(row)).toEqual({ targetReps: 10 });
  });

  it("prefers the planned value over the actual for each axis independently", () => {
    const row = makeExerciseSet({
      reps: 8,
      plannedReps: 10,
      weight: 95,
      plannedWeight: null, // no planned weight — falls back to actual
      distance: 500,
      plannedDistance: 450,
      time: 60,
      plannedTime: null, // falls back to actual
    });

    expect(structureTargetsFromExerciseSet(row)).toEqual({
      targetReps: 10,
      targetWeight: 95,
      targetDistance: 450,
      targetTime: 60,
    });
  });
});

describe("queryExerciseSetsWithDates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("flattens each log's exercise sets and stamps them with the parent log's date and time", async () => {
    vi.mocked(db.query.workoutLogs.findMany).mockResolvedValue([
      {
        id: "log-1",
        date: "2026-06-02",
        timeOfDayMin: 420,
        exerciseSets: [makeExerciseSet({ id: "set-1" }), makeExerciseSet({ id: "set-2" })],
      },
      {
        id: "log-2",
        date: "2026-06-01",
        timeOfDayMin: null,
        exerciseSets: [makeExerciseSet({ id: "set-3" })],
      },
    ] as never);

    const result = await queryExerciseSetsWithDates("user-1");

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ id: "set-1", workoutLogId: "log-1", date: "2026-06-02", timeOfDayMin: 420 });
    expect(result[2]).toMatchObject({ id: "set-3", workoutLogId: "log-2", date: "2026-06-01", timeOfDayMin: null });
  });

  it("scopes the nested exerciseSets relation to the requested exercise name, and leaves it unscoped otherwise", async () => {
    vi.mocked(db.query.workoutLogs.findMany).mockResolvedValue([]);

    await queryExerciseSetsWithDates("user-1", { exerciseName: "burpee" });
    const scopedArgs = vi.mocked(db.query.workoutLogs.findMany).mock.calls[0]?.[0] as {
      with: { exerciseSets: true | { where: unknown } };
    };
    expect(scopedArgs.with.exerciseSets).not.toBe(true);

    await queryExerciseSetsWithDates("user-1");
    const unscopedArgs = vi.mocked(db.query.workoutLogs.findMany).mock.calls[1]?.[0] as {
      with: { exerciseSets: true | { where: unknown } };
    };
    expect(unscopedArgs.with.exerciseSets).toBe(true);
  });

  it("warns when the row cap is hit, so truncated analytics can be noticed", async () => {
    const cappedLogs = Array.from({ length: MAX_WORKOUT_LOGS_PER_QUERY }, (_, i) => ({
      id: `log-${i}`,
      date: "2026-06-01",
      timeOfDayMin: null,
      exerciseSets: [],
    }));
    vi.mocked(db.query.workoutLogs.findMany).mockResolvedValue(cappedLogs as never);

    await queryExerciseSetsWithDates("user-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", limit: MAX_WORKOUT_LOGS_PER_QUERY }),
      expect.stringContaining("hit row cap"),
    );
  });

  it("does not warn when the result stays under the row cap", async () => {
    vi.mocked(db.query.workoutLogs.findMany).mockResolvedValue([
      { id: "log-1", date: "2026-06-01", timeOfDayMin: null, exerciseSets: [] },
    ] as never);

    await queryExerciseSetsWithDates("user-1");

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

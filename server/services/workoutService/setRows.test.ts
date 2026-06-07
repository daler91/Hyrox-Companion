import { type ParsedExercise } from "@shared/schema";
import type { UnitPreferences } from "@shared/unitConversion";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError, ErrorCode } from "../../errors";
import { parseExercisesFromText } from "../../gemini";
import {
  expandExercisesToPlanDaySetRows,
  expandExercisesToRows,
  expandExercisesToSetRows,
  extractAndDeduplicateCustomExercises,
  prepareParsedWorkout,
} from "./setRows";

vi.mock("../../gemini", () => ({ parseExercisesFromText: vi.fn() }));

const parseMock = vi.mocked(parseExercisesFromText);

const BACK_SQUAT = "back_squat";
const STRENGTH = "strength";
const WORKOUT_ID = "w1";
const UNITS: UnitPreferences = { weightUnit: "kg", distanceUnit: "km" };

function pe(overrides: Partial<ParsedExercise> = {}): ParsedExercise {
  return {
    exerciseName: BACK_SQUAT,
    category: STRENGTH,
    ...overrides,
  } as unknown as ParsedExercise;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractAndDeduplicateCustomExercises", () => {
  it("returns an empty list for no exercises", () => {
    expect(extractAndDeduplicateCustomExercises([], "user-1")).toEqual([]);
  });

  it("ignores non-custom exercises", () => {
    expect(
      extractAndDeduplicateCustomExercises([pe({ exerciseName: BACK_SQUAT })], "user-1"),
    ).toEqual([]);
  });

  it("ignores custom exercises that have no custom label", () => {
    expect(
      extractAndDeduplicateCustomExercises([pe({ exerciseName: "custom" })], "user-1"),
    ).toEqual([]);
  });

  it("extracts a labelled custom exercise with its category", () => {
    const result = extractAndDeduplicateCustomExercises(
      [pe({ exerciseName: "custom", customLabel: "Sled Drag", category: "functional" })],
      "user-1",
    );
    expect(result).toEqual([{ userId: "user-1", name: "Sled Drag", category: "functional" }]);
  });

  it("defaults the category to conditioning when absent", () => {
    const result = extractAndDeduplicateCustomExercises(
      [{ exerciseName: "custom", customLabel: "Mystery" } as unknown as ParsedExercise],
      "user-1",
    );
    expect(result).toEqual([{ userId: "user-1", name: "Mystery", category: "conditioning" }]);
  });

  it("de-duplicates by label, keeping the last occurrence's category", () => {
    const result = extractAndDeduplicateCustomExercises(
      [
        pe({ exerciseName: "custom", customLabel: "Carry", category: "functional" }),
        pe({ exerciseName: "custom", customLabel: "Carry", category: "conditioning" }),
      ],
      "user-1",
    );
    expect(result).toEqual([{ userId: "user-1", name: "Carry", category: "conditioning" }]);
  });

  it("keeps distinct custom labels separate", () => {
    const result = extractAndDeduplicateCustomExercises(
      [
        pe({ exerciseName: "custom", customLabel: "Carry" }),
        pe({ exerciseName: "custom", customLabel: "Crawl" }),
        pe({ exerciseName: BACK_SQUAT }),
      ],
      "user-1",
    );
    expect(result.map((c) => c.name)).toEqual(["Carry", "Crawl"]);
  });
});

describe("expandExercisesToRows", () => {
  it("returns an empty array for no exercises", () => {
    expect(expandExercisesToRows([], { workoutLogId: WORKOUT_ID }, "workout")).toEqual([]);
  });

  it("expands explicit sets into one row each with running sortOrder", () => {
    const rows = expandExercisesToRows(
      [
        pe({
          sets: [
            { setNumber: 1, reps: 5 },
            { setNumber: 2, reps: 6 },
          ],
        }),
      ],
      { workoutLogId: WORKOUT_ID },
      "workout",
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.setNumber, r.reps, r.sortOrder])).toEqual([
      [1, 5, 0],
      [2, 6, 1],
    ]);
  });

  it("maps every field of an explicit set for a workout owner", () => {
    const rows = expandExercisesToRows(
      [pe({ confidence: 0.8, sets: [{ setNumber: 2, reps: 5, weight: 100, notes: "deep" }] })],
      { workoutLogId: WORKOUT_ID },
      "workout",
    );
    expect(rows[0]).toEqual({
      workoutLogId: WORKOUT_ID,
      planDayId: null,
      exerciseName: BACK_SQUAT,
      customLabel: null,
      category: STRENGTH,
      setNumber: 2,
      reps: 5,
      weight: 100,
      distance: null,
      time: null,
      plannedReps: null,
      plannedWeight: null,
      plannedDistance: null,
      plannedTime: null,
      blockId: null,
      stepNumber: null,
      intervalMinute: null,
      cycleNumber: null,
      stepRole: null,
      groupId: null,
      intensity: null,
      load: null,
      repMode: null,
      tempo: null,
      standards: null,
      confidence: 0.8,
      notes: "deep",
      sortOrder: 0,
    });
  });

  it("expands the numSets aggregate when there are no explicit sets", () => {
    const rows = expandExercisesToRows(
      [pe({ numSets: 3, reps: 10, weight: 60 })],
      { workoutLogId: WORKOUT_ID },
      "workout",
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.setNumber)).toEqual([1, 2, 3]);
    expect(rows.every((r) => r.reps === 10 && r.weight === 60)).toBe(true);
  });

  it("defaults the aggregate to a single set when numSets is absent", () => {
    const rows = expandExercisesToRows([pe({ reps: 10 })], { workoutLogId: WORKOUT_ID }, "workout");
    expect(rows).toHaveLength(1);
    expect(rows[0].setNumber).toBe(1);
  });

  it("produces no rows for an explicit empty sets array (does not fall back to numSets)", () => {
    const rows = expandExercisesToRows(
      [pe({ sets: [], numSets: 5 })],
      { workoutLogId: WORKOUT_ID },
      "workout",
    );
    expect(rows).toEqual([]);
  });

  it("falls back to set number 1 when an explicit set number is missing", () => {
    const rows = expandExercisesToRows(
      [pe({ sets: [{ setNumber: 0, reps: 5 }] })],
      { workoutLogId: WORKOUT_ID },
      "workout",
    );
    expect(rows[0].setNumber).toBe(1);
  });

  it("nulls a missing measurement on an explicit set", () => {
    const rows = expandExercisesToRows(
      [pe({ sets: [{ setNumber: 1, weight: 100 }] })],
      { workoutLogId: WORKOUT_ID },
      "workout",
    );
    expect(rows[0].reps).toBeNull();
    expect(rows[0].weight).toBe(100);
  });

  it("continues sortOrder across multiple exercises", () => {
    const rows = expandExercisesToRows(
      [pe({ numSets: 2 }), pe({ exerciseName: "deadlift", numSets: 2 })],
      { workoutLogId: WORKOUT_ID },
      "workout",
    );
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2, 3]);
    expect(rows.map((r) => r.exerciseName)).toEqual([
      BACK_SQUAT,
      BACK_SQUAT,
      "deadlift",
      "deadlift",
    ]);
  });

  it("allows exactly the row cap", () => {
    const rows = expandExercisesToRows(
      [pe({ numSets: 1000 })],
      { workoutLogId: WORKOUT_ID },
      "workout",
    );
    expect(rows).toHaveLength(1000);
  });

  it("throws a 400 AppError when the workout exceeds the row cap", () => {
    let thrown: unknown;
    try {
      expandExercisesToRows([pe({ numSets: 1001 })], { workoutLogId: WORKOUT_ID }, "workout");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    const appErr = thrown as AppError;
    expect(appErr.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(appErr.status).toBe(400);
    expect(appErr.details).toEqual({ setRows: 1001, limit: 1000 });
    expect(appErr.message).toContain("Workout expanded to 1001 set rows");
    expect(appErr.message).toContain("Split into multiple workouts");
  });

  it("uses plan-day wording in the cap error for the plan context", () => {
    expect(() =>
      expandExercisesToRows([pe({ numSets: 1001 })], { planDayId: "p1" }, "plan"),
    ).toThrow(/Plan day expanded to 1001 set rows .* Split into multiple days/);
  });
});

describe("owner-specific wrappers", () => {
  it("expandExercisesToSetRows roots rows in the workout log", () => {
    const rows = expandExercisesToSetRows([pe({ numSets: 1 })], WORKOUT_ID);
    expect(rows[0]).toMatchObject({ workoutLogId: WORKOUT_ID, planDayId: null });
  });

  it("expandExercisesToPlanDaySetRows roots rows in the plan day", () => {
    const rows = expandExercisesToPlanDaySetRows([pe({ numSets: 1 })], "p1");
    expect(rows[0]).toMatchObject({ workoutLogId: null, planDayId: "p1" });
  });
});

describe("prepareParsedWorkout", () => {
  it("returns null when there is no free text", async () => {
    const result = await prepareParsedWorkout(
      { id: WORKOUT_ID, mainWorkout: null, accessory: null },
      UNITS,
    );
    expect(result).toBeNull();
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("returns null when the parser yields no exercises", async () => {
    parseMock.mockResolvedValue([]);
    const result = await prepareParsedWorkout({ id: WORKOUT_ID, mainWorkout: "5 squats" }, UNITS);
    expect(result).toBeNull();
  });

  it("parses the trimmed text and expands the rows", async () => {
    parseMock.mockResolvedValue([pe({ sets: [{ setNumber: 1, reps: 5 }] })]);

    const result = await prepareParsedWorkout(
      { id: WORKOUT_ID, mainWorkout: "Squats", accessory: "Lunges" },
      UNITS,
    );

    expect(parseMock).toHaveBeenCalledWith("Squats\nLunges", UNITS);
    expect(result?.exercises).toHaveLength(1);
    expect(result?.setRows[0]).toMatchObject({ workoutLogId: WORKOUT_ID, setNumber: 1, reps: 5 });
  });

  it("trims surrounding whitespace and tolerates a missing main workout", async () => {
    parseMock.mockResolvedValue([pe({ numSets: 1 })]);
    await prepareParsedWorkout(
      { id: WORKOUT_ID, mainWorkout: null, accessory: "  Pushups  " },
      UNITS,
    );
    expect(parseMock).toHaveBeenCalledWith("Pushups", UNITS);
  });
});

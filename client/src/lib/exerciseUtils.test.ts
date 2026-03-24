import { describe, it, expect } from "vitest";
import {
  formatExerciseSummary,
  getExerciseLabel,
  type GroupedExercise,
  exerciseSetsToStructured,
} from "./exerciseUtils";
import { type ExerciseSet } from "@shared/schema";

describe("getExerciseLabel", () => {
  it("returns label for known exercise name", () => {
    expect(getExerciseLabel("unknown_exercise_123")).toBe("unknown_exercise_123");
  });

  it("handles custom prefix", () => {
    expect(getExerciseLabel("custom:My Custom Exercise")).toBe("My Custom Exercise");
  });

  it("handles custom exercise with customLabel", () => {
    expect(getExerciseLabel("custom", "Special Lift")).toBe("Special Lift");
  });
});

describe("formatExerciseSummary", () => {
  const createGroup = (
    exerciseName: string,
    category: string,
    customLabel: string | undefined,
    setsData: Record<string, unknown>[],
  ): GroupedExercise => ({
    exerciseName,
    customLabel,
    category,
    sets: setsData.map((s, i) => ({
      id: i + 1,
      workoutId: 1,
      exerciseName,
      category,
      order: i + 1,
      createdAt: new Date(),
      notes: null,
      ...s,
    })) as unknown as GroupedExercise["sets"],
  });

  it.each([
    {
      desc: "returns name if sets are empty",
      group: createGroup("custom", "strength", "Test", []),
      weightUnit: "kg",
      distanceUnit: "km",
      expected: "Test",
    },
    {
      desc: "formats single set with reps",
      group: createGroup("custom", "strength", "Test", [
        { reps: 10, weight: null, distance: null, time: null },
      ]),
      weightUnit: "kg",
      distanceUnit: "km",
      expected: "Test 10r",
    },
    {
      desc: "formats multiple sets with same reps",
      group: createGroup("custom", "strength", "Test", [
        { reps: 10, weight: null, distance: null, time: null },
        { reps: 10, weight: null, distance: null, time: null },
        { reps: 10, weight: null, distance: null, time: null },
      ]),
      weightUnit: "kg",
      distanceUnit: "km",
      expected: "Test 3x10",
    },
    {
      desc: "formats multiple sets with varying reps",
      group: createGroup("custom", "strength", "Test", [
        { reps: 12, weight: null, distance: null, time: null },
        { reps: 10, weight: null, distance: null, time: null },
        { reps: 8, weight: null, distance: null, time: null },
      ]),
      weightUnit: "kg",
      distanceUnit: "km",
      expected: "Test 3s",
    },
    {
      desc: "formats sets with same weight",
      group: createGroup("custom", "strength", "Test", [
        { reps: 10, weight: 50, distance: null, time: null },
        { reps: 10, weight: 50, distance: null, time: null },
      ]),
      weightUnit: "kg",
      distanceUnit: "km",
      expected: "Test 2x10 50kg",
    },
    {
      desc: "formats sets with varying weights",
      group: createGroup("custom", "strength", "Test", [
        { reps: 10, weight: 40, distance: null, time: null },
        { reps: 10, weight: 50, distance: null, time: null },
        { reps: 10, weight: 60, distance: null, time: null },
      ]),
      weightUnit: "lbs",
      distanceUnit: "km",
      expected: "Test 3x10 40/50/60lbs",
    },
    {
      desc: "formats distance and time for km unit",
      group: createGroup("running", "cardio", undefined, [
        { reps: null, weight: null, distance: 5000, time: 25 },
      ]),
      weightUnit: "kg",
      distanceUnit: "km",
      expected: "running 5000m 25min",
    },
    {
      desc: "formats distance and time for miles unit",
      group: createGroup("running", "cardio", undefined, [
        { reps: null, weight: null, distance: 16404, time: 25 },
      ]),
      weightUnit: "lbs",
      distanceUnit: "miles",
      expected: "running 16404ft 25min",
    },
  ])("$desc", ({ group, weightUnit, distanceUnit, expected }) => {
    expect(formatExerciseSummary(group, weightUnit, distanceUnit)).toBe(expected);
  });
});

describe("exerciseSetsToStructured", () => {
  it("returns empty result for empty input", () => {
    const { names, data } = exerciseSetsToStructured([]);
    expect(names).toEqual([]);
    expect(data).toEqual({});
  });

  const runTest = (sets: any, assert: (names: string[], data: any) => void) => {
    const { names, data } = exerciseSetsToStructured(sets as ExerciseSet[]);
    assert(names, data);
  };

  it.each([
    {
      desc: "structures a single exercise with multiple sets",
      sets: [
        {
          id: 1,
          workoutId: 1,
          exerciseName: "bench_press",
          category: "strength",
          sortOrder: 1,
          setNumber: 1,
          reps: 10,
          weight: 60,
          distance: null,
          time: null,
          notes: "warmup",
        },
        {
          id: 2,
          workoutId: 1,
          exerciseName: "bench_press",
          category: "strength",
          sortOrder: 2,
          setNumber: 2,
          reps: 8,
          weight: 70,
          distance: null,
          time: null,
          notes: null,
        },
      ],
      assert: (names: string[], data: any) => {
        expect(names).toEqual(["bench_press__1"]);
        expect(data["bench_press__1"]).toBeDefined();
        expect(data["bench_press__1"].exerciseName).toBe("bench_press");
        expect(data["bench_press__1"].category).toBe("strength");
        expect(data["bench_press__1"].sets).toHaveLength(2);
        expect(data["bench_press__1"].sets[0]).toEqual({
          setNumber: 1,
          reps: 10,
          weight: 60,
          distance: undefined,
          time: undefined,
          notes: "warmup",
        });
        expect(data["bench_press__1"].sets[1]).toEqual({
          setNumber: 2,
          reps: 8,
          weight: 70,
          distance: undefined,
          time: undefined,
          notes: undefined,
        });
      },
    },
    {
      desc: "handles multiple different exercises",
      sets: [
        {
          id: 1,
          workoutId: 1,
          exerciseName: "squat",
          category: "strength",
          sortOrder: 1,
          setNumber: 1,
          reps: 5,
        },
        {
          id: 2,
          workoutId: 1,
          exerciseName: "deadlift",
          category: "strength",
          sortOrder: 2,
          setNumber: 1,
          reps: 3,
        },
      ],
      assert: (names: string[], data: any) => {
        expect(names).toEqual(["squat__1", "deadlift__1"]);
        expect(data["squat__1"]).toBeDefined();
        expect(data["deadlift__1"]).toBeDefined();
        expect(data["squat__1"].sets[0].reps).toBe(5);
        expect(data["deadlift__1"].sets[0].reps).toBe(3);
      },
    },
    {
      desc: "handles custom exercises with customLabel properly",
      sets: [
        {
          id: 1,
          workoutId: 1,
          exerciseName: "custom",
          customLabel: "Bicep Curls",
          category: "strength",
          sortOrder: 1,
          setNumber: 1,
          reps: 12,
        },
        {
          id: 2,
          workoutId: 1,
          exerciseName: "custom",
          customLabel: "Bicep Curls",
          category: "strength",
          sortOrder: 2,
          setNumber: 2,
          reps: 10,
        },
      ],
      assert: (names: string[], data: any) => {
        expect(names).toEqual(["custom:Bicep Curls__1"]);
        expect(data["custom:Bicep Curls__1"].exerciseName).toBe("custom");
        expect(data["custom:Bicep Curls__1"].customLabel).toBe("Bicep Curls");
        expect(data["custom:Bicep Curls__1"].sets).toHaveLength(2);
      },
    },
    {
      desc: "properly increments counter for separated but identically named exercises",
      sets: [
        {
          id: 1,
          workoutId: 1,
          exerciseName: "pull_up",
          category: "strength",
          sortOrder: 1,
          setNumber: 1,
          reps: 10,
        },
        {
          id: 2,
          workoutId: 1,
          exerciseName: "push_up",
          category: "strength",
          sortOrder: 2,
          setNumber: 1,
          reps: 20,
        },
        {
          id: 3,
          workoutId: 1,
          exerciseName: "pull_up",
          category: "strength",
          sortOrder: 3,
          setNumber: 1,
          reps: 8,
        },
      ],
      assert: (names: string[], data: any) => {
        expect(names).toEqual(["pull_up__1", "push_up__1", "pull_up__2"]);
        expect(data["pull_up__1"].sets[0].reps).toBe(10);
        expect(data["pull_up__2"].sets[0].reps).toBe(8);
      },
    },
    {
      desc: "maps confidence score correctly",
      sets: [
        {
          id: 1,
          workoutId: 1,
          exerciseName: "running",
          category: "cardio",
          sortOrder: 1,
          setNumber: 1,
          distance: 5000,
          confidence: 0.95,
        },
      ],
      assert: (_names: string[], data: any) => {
        expect(data["running__1"].confidence).toBe(0.95);
      },
    },
  ])("$desc", ({ sets, assert }) => runTest(sets, assert));
});

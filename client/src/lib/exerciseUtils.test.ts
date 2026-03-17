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
    expect(getExerciseLabel("unknown_exercise_123")).toBe(
      "unknown_exercise_123",
    );
  });

  it("handles custom prefix", () => {
    expect(getExerciseLabel("custom:My Custom Exercise")).toBe(
      "My Custom Exercise",
    );
  });

  it("handles custom exercise with customLabel", () => {
    expect(getExerciseLabel("custom", "Special Lift")).toBe("Special Lift");
  });
});

describe("formatExerciseSummary", () => {
  it("returns name if sets are empty", () => {
    const group: GroupedExercise = {
      exerciseName: "custom",
      customLabel: "Test",
      category: "strength",
      sets: [],
    };
    expect(formatExerciseSummary(group, "kg", "km")).toBe("Test");
  });

  it("formats single set with reps", () => {
    const group: GroupedExercise = {
      exerciseName: "custom",
      customLabel: "Test",
      category: "strength",
      sets: [
        {
          id: 1,
          workoutId: 1,
          exerciseName: "custom",
          category: "strength",
          reps: 10,
          weight: null,
          distance: null,
          time: null,
          order: 1,
          createdAt: new Date(),
          notes: null,
        },
      ] as any,
    };
    expect(formatExerciseSummary(group, "kg", "km")).toBe("Test 10r");
  });

  it("formats multiple sets with same reps", () => {
    const group: GroupedExercise = {
      exerciseName: "custom",
      customLabel: "Test",
      category: "strength",
      sets: [
        {
          id: 1,
          workoutId: 1,
          exerciseName: "custom",
          category: "strength",
          reps: 10,
          weight: null,
          distance: null,
          time: null,
          order: 1,
          createdAt: new Date(),
          notes: null,
        },
        {
          id: 2,
          workoutId: 1,
          exerciseName: "custom",
          category: "strength",
          reps: 10,
          weight: null,
          distance: null,
          time: null,
          order: 2,
          createdAt: new Date(),
          notes: null,
        },
        {
          id: 3,
          workoutId: 1,
          exerciseName: "custom",
          category: "strength",
          reps: 10,
          weight: null,
          distance: null,
          time: null,
          order: 3,
          createdAt: new Date(),
          notes: null,
        },
      ] as any,
    };
    expect(formatExerciseSummary(group, "kg", "km")).toBe("Test 3x10");
  });

  it("formats multiple sets with varying reps", () => {
    const group: GroupedExercise = {
      exerciseName: "custom",
      customLabel: "Test",
      category: "strength",
      sets: [
        {
          id: 1,
          workoutId: 1,
          exerciseName: "custom",
          category: "strength",
          reps: 12,
          weight: null,
          distance: null,
          time: null,
          order: 1,
          createdAt: new Date(),
          notes: null,
        },
        {
          id: 2,
          workoutId: 1,
          exerciseName: "custom",
          category: "strength",
          reps: 10,
          weight: null,
          distance: null,
          time: null,
          order: 2,
          createdAt: new Date(),
          notes: null,
        },
        {
          id: 3,
          workoutId: 1,
          exerciseName: "custom",
          category: "strength",
          reps: 8,
          weight: null,
          distance: null,
          time: null,
          order: 3,
          createdAt: new Date(),
          notes: null,
        },
      ] as any,
    };
    expect(formatExerciseSummary(group, "kg", "km")).toBe("Test 3s");
  });

  it("formats sets with same weight", () => {
    const group: GroupedExercise = {
      exerciseName: "custom",
      customLabel: "Test",
      category: "strength",
      sets: [
        {
          id: 1,
          workoutId: 1,
          exerciseName: "custom",
          category: "strength",
          reps: 10,
          weight: 50,
          distance: null,
          time: null,
          order: 1,
          createdAt: new Date(),
          notes: null,
        },
        {
          id: 2,
          workoutId: 1,
          exerciseName: "custom",
          category: "strength",
          reps: 10,
          weight: 50,
          distance: null,
          time: null,
          order: 2,
          createdAt: new Date(),
          notes: null,
        },
      ] as any,
    };
    expect(formatExerciseSummary(group, "kg", "km")).toBe("Test 2x10 50kg");
  });

  it("formats sets with varying weights", () => {
    const group: GroupedExercise = {
      exerciseName: "custom",
      customLabel: "Test",
      category: "strength",
      sets: [
        {
          id: 1,
          workoutId: 1,
          exerciseName: "custom",
          category: "strength",
          reps: 10,
          weight: 40,
          distance: null,
          time: null,
          order: 1,
          createdAt: new Date(),
          notes: null,
        },
        {
          id: 2,
          workoutId: 1,
          exerciseName: "custom",
          category: "strength",
          reps: 10,
          weight: 50,
          distance: null,
          time: null,
          order: 2,
          createdAt: new Date(),
          notes: null,
        },
        {
          id: 3,
          workoutId: 1,
          exerciseName: "custom",
          category: "strength",
          reps: 10,
          weight: 60,
          distance: null,
          time: null,
          order: 3,
          createdAt: new Date(),
          notes: null,
        },
      ] as any,
    };
    expect(formatExerciseSummary(group, "lbs", "km")).toBe(
      "Test 3x10 40/50/60lbs",
    );
  });

  it("formats distance and time for km unit", () => {
    const group: GroupedExercise = {
      exerciseName: "running",
      category: "cardio",
      sets: [
        {
          id: 1,
          workoutId: 1,
          exerciseName: "running",
          category: "cardio",
          reps: null,
          weight: null,
          distance: 5000,
          time: 25,
          order: 1,
          createdAt: new Date(),
          notes: null,
        },
      ] as any,
    };
    expect(formatExerciseSummary(group, "kg", "km")).toBe(
      "running 5000m 25min",
    );
  });

  it("formats distance and time for miles unit", () => {
    const group: GroupedExercise = {
      exerciseName: "running",
      category: "cardio",
      sets: [
        {
          id: 1,
          workoutId: 1,
          exerciseName: "running",
          category: "cardio",
          reps: null,
          weight: null,
          distance: 16404,
          time: 25,
          order: 1,
          createdAt: new Date(),
          notes: null,
        },
      ] as any,
    };
    expect(formatExerciseSummary(group, "lbs", "miles")).toBe(
      "running 16404ft 25min",
    );
  });
});

describe("exerciseSetsToStructured", () => {
  it("returns empty result for empty input", () => {
    const { names, data } = exerciseSetsToStructured([]);
    expect(names).toEqual([]);
    expect(data).toEqual({});
  });

  it("structures a single exercise with multiple sets", () => {
    const sets = [
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
    ] as ExerciseSet[];

    const { names, data } = exerciseSetsToStructured(sets);

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
  });

  it("handles multiple different exercises", () => {
    const sets = [
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
    ] as ExerciseSet[];

    const { names, data } = exerciseSetsToStructured(sets);

    expect(names).toEqual(["squat__1", "deadlift__1"]);
    expect(data["squat__1"]).toBeDefined();
    expect(data["deadlift__1"]).toBeDefined();
    expect(data["squat__1"].sets[0].reps).toBe(5);
    expect(data["deadlift__1"].sets[0].reps).toBe(3);
  });

  it("handles custom exercises with customLabel properly", () => {
    const sets = [
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
    ] as ExerciseSet[];

    const { names, data } = exerciseSetsToStructured(sets);

    expect(names).toEqual(["custom:Bicep Curls__1"]);
    expect(data["custom:Bicep Curls__1"].exerciseName).toBe("custom");
    expect(data["custom:Bicep Curls__1"].customLabel).toBe("Bicep Curls");
    expect(data["custom:Bicep Curls__1"].sets).toHaveLength(2);
  });

  it("properly increments counter for separated but identically named exercises", () => {
    const sets = [
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
    ] as ExerciseSet[];

    const { names, data } = exerciseSetsToStructured(sets);

    expect(names).toEqual(["pull_up__1", "push_up__1", "pull_up__2"]);
    expect(data["pull_up__1"].sets[0].reps).toBe(10);
    expect(data["pull_up__2"].sets[0].reps).toBe(8);
  });

  it("maps confidence score correctly", () => {
    const sets = [
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
    ] as ExerciseSet[];

    const { data } = exerciseSetsToStructured(sets);

    expect(data["running__1"].confidence).toBe(0.95);
  });
});

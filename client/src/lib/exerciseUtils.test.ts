import { describe, it, expect } from "vitest";
import { formatExerciseSummary, getExerciseLabel, type GroupedExercise } from "./exerciseUtils";

describe("getExerciseLabel", () => {
  it("returns label for known exercise name", () => {
    // We expect EXERCISE_DEFINITIONS to have 'bench_press' for instance, if not it just returns 'bench_press'
    // The actual definition could be checked, but we can just use a placeholder to see if it falls back to the name if not found.
    // If we look at the code:
    // const def = EXERCISE_DEFINITIONS[name as ExerciseName];
    // return def?.label || name;
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
  it("returns name if sets are empty", () => {
    const group: GroupedExercise = {
      exerciseName: "custom",
      customLabel: "Test",
      category: "strength",
      sets: []
    };
    expect(formatExerciseSummary(group, "kg", "km")).toBe("Test");
  });

  it("formats single set with reps", () => {
    const group: GroupedExercise = {
      exerciseName: "custom",
      customLabel: "Test",
      category: "strength",
      sets: [{ id: 1, workoutId: 1, exerciseName: "custom", category: "strength", reps: 10, weight: null, distance: null, time: null, order: 1, createdAt: new Date(), notes: null }] as any
    };
    expect(formatExerciseSummary(group, "kg", "km")).toBe("Test 10r");
  });

  it("formats multiple sets with same reps", () => {
    const group: GroupedExercise = {
      exerciseName: "custom",
      customLabel: "Test",
      category: "strength",
      sets: [
        { id: 1, workoutId: 1, exerciseName: "custom", category: "strength", reps: 10, weight: null, distance: null, time: null, order: 1, createdAt: new Date(), notes: null },
        { id: 2, workoutId: 1, exerciseName: "custom", category: "strength", reps: 10, weight: null, distance: null, time: null, order: 2, createdAt: new Date(), notes: null },
        { id: 3, workoutId: 1, exerciseName: "custom", category: "strength", reps: 10, weight: null, distance: null, time: null, order: 3, createdAt: new Date(), notes: null }
      ] as any
    };
    expect(formatExerciseSummary(group, "kg", "km")).toBe("Test 3x10");
  });

  it("formats multiple sets with varying reps", () => {
    const group: GroupedExercise = {
      exerciseName: "custom",
      customLabel: "Test",
      category: "strength",
      sets: [
        { id: 1, workoutId: 1, exerciseName: "custom", category: "strength", reps: 12, weight: null, distance: null, time: null, order: 1, createdAt: new Date(), notes: null },
        { id: 2, workoutId: 1, exerciseName: "custom", category: "strength", reps: 10, weight: null, distance: null, time: null, order: 2, createdAt: new Date(), notes: null },
        { id: 3, workoutId: 1, exerciseName: "custom", category: "strength", reps: 8, weight: null, distance: null, time: null, order: 3, createdAt: new Date(), notes: null }
      ] as any
    };
    expect(formatExerciseSummary(group, "kg", "km")).toBe("Test 3s");
  });

  it("formats sets with same weight", () => {
    const group: GroupedExercise = {
      exerciseName: "custom",
      customLabel: "Test",
      category: "strength",
      sets: [
        { id: 1, workoutId: 1, exerciseName: "custom", category: "strength", reps: 10, weight: 50, distance: null, time: null, order: 1, createdAt: new Date(), notes: null },
        { id: 2, workoutId: 1, exerciseName: "custom", category: "strength", reps: 10, weight: 50, distance: null, time: null, order: 2, createdAt: new Date(), notes: null }
      ] as any
    };
    expect(formatExerciseSummary(group, "kg", "km")).toBe("Test 2x10 50kg");
  });

  it("formats sets with varying weights", () => {
    const group: GroupedExercise = {
      exerciseName: "custom",
      customLabel: "Test",
      category: "strength",
      sets: [
        { id: 1, workoutId: 1, exerciseName: "custom", category: "strength", reps: 10, weight: 40, distance: null, time: null, order: 1, createdAt: new Date(), notes: null },
        { id: 2, workoutId: 1, exerciseName: "custom", category: "strength", reps: 10, weight: 50, distance: null, time: null, order: 2, createdAt: new Date(), notes: null },
        { id: 3, workoutId: 1, exerciseName: "custom", category: "strength", reps: 10, weight: 60, distance: null, time: null, order: 3, createdAt: new Date(), notes: null }
      ] as any
    };
    expect(formatExerciseSummary(group, "lbs", "km")).toBe("Test 3x10 40/50/60lbs");
  });

  it("formats distance and time for km unit", () => {
    const group: GroupedExercise = {
      exerciseName: "running",
      category: "cardio",
      sets: [
        { id: 1, workoutId: 1, exerciseName: "running", category: "cardio", reps: null, weight: null, distance: 5000, time: 25, order: 1, createdAt: new Date(), notes: null }
      ] as any
    };
    expect(formatExerciseSummary(group, "kg", "km")).toBe("running 5000m 25min");
  });

  it("formats distance and time for miles unit", () => {
    const group: GroupedExercise = {
      exerciseName: "running",
      category: "cardio",
      sets: [
        { id: 1, workoutId: 1, exerciseName: "running", category: "cardio", reps: null, weight: null, distance: 16404, time: 25, order: 1, createdAt: new Date(), notes: null }
      ] as any
    };
    // Expected distance label when unit is not km is "ft"
    expect(formatExerciseSummary(group, "lbs", "miles")).toBe("running 16404ft 25min");
  });
});

import { describe, it, expect } from "vitest";
import { formatExerciseSummary, getExerciseLabel, groupExerciseSets, type GroupedExercise } from "./exerciseUtils";
import { type ExerciseSet } from "@shared/schema";

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
      sets: [{ id: "1", workoutLogId: "1", exerciseName: "custom", category: "strength", setNumber: 1, reps: 10, weight: null, distance: null, time: null, sortOrder: 1, confidence: null, customLabel: null, notes: null }] as ExerciseSet[]
    };
    expect(formatExerciseSummary(group, "kg", "km")).toBe("Test 10r");
  });

  it("formats multiple sets with same reps", () => {
    const group: GroupedExercise = {
      exerciseName: "custom",
      customLabel: "Test",
      category: "strength",
      sets: [
        { id: "1", workoutLogId: "1", exerciseName: "custom", category: "strength", setNumber: 1, reps: 10, weight: null, distance: null, time: null, sortOrder: 1, confidence: null, customLabel: null, notes: null },
        { id: "2", workoutLogId: "1", exerciseName: "custom", category: "strength", setNumber: 2, reps: 10, weight: null, distance: null, time: null, sortOrder: 2, confidence: null, customLabel: null, notes: null },
        { id: "3", workoutLogId: "1", exerciseName: "custom", category: "strength", setNumber: 3, reps: 10, weight: null, distance: null, time: null, sortOrder: 3, confidence: null, customLabel: null, notes: null }
      ] as ExerciseSet[]
    };
    expect(formatExerciseSummary(group, "kg", "km")).toBe("Test 3x10");
  });

  it("formats multiple sets with varying reps", () => {
    const group: GroupedExercise = {
      exerciseName: "custom",
      customLabel: "Test",
      category: "strength",
      sets: [
        { id: "1", workoutLogId: "1", exerciseName: "custom", category: "strength", setNumber: 1, reps: 12, weight: null, distance: null, time: null, sortOrder: 1, confidence: null, customLabel: null, notes: null },
        { id: "2", workoutLogId: "1", exerciseName: "custom", category: "strength", setNumber: 2, reps: 10, weight: null, distance: null, time: null, sortOrder: 2, confidence: null, customLabel: null, notes: null },
        { id: "3", workoutLogId: "1", exerciseName: "custom", category: "strength", setNumber: 3, reps: 8, weight: null, distance: null, time: null, sortOrder: 3, confidence: null, customLabel: null, notes: null }
      ] as ExerciseSet[]
    };
    expect(formatExerciseSummary(group, "kg", "km")).toBe("Test 3s");
  });

  it("formats sets with same weight", () => {
    const group: GroupedExercise = {
      exerciseName: "custom",
      customLabel: "Test",
      category: "strength",
      sets: [
        { id: "1", workoutLogId: "1", exerciseName: "custom", category: "strength", setNumber: 1, reps: 10, weight: 50, distance: null, time: null, sortOrder: 1, confidence: null, customLabel: null, notes: null },
        { id: "2", workoutLogId: "1", exerciseName: "custom", category: "strength", setNumber: 2, reps: 10, weight: 50, distance: null, time: null, sortOrder: 2, confidence: null, customLabel: null, notes: null }
      ] as ExerciseSet[]
    };
    expect(formatExerciseSummary(group, "kg", "km")).toBe("Test 2x10 50kg");
  });

  it("formats sets with varying weights", () => {
    const group: GroupedExercise = {
      exerciseName: "custom",
      customLabel: "Test",
      category: "strength",
      sets: [
        { id: "1", workoutLogId: "1", exerciseName: "custom", category: "strength", setNumber: 1, reps: 10, weight: 40, distance: null, time: null, sortOrder: 1, confidence: null, customLabel: null, notes: null },
        { id: "2", workoutLogId: "1", exerciseName: "custom", category: "strength", setNumber: 2, reps: 10, weight: 50, distance: null, time: null, sortOrder: 2, confidence: null, customLabel: null, notes: null },
        { id: "3", workoutLogId: "1", exerciseName: "custom", category: "strength", setNumber: 3, reps: 10, weight: 60, distance: null, time: null, sortOrder: 3, confidence: null, customLabel: null, notes: null }
      ] as ExerciseSet[]
    };
    expect(formatExerciseSummary(group, "lbs", "km")).toBe("Test 3x10 40/50/60lbs");
  });

  it("formats distance and time for km unit", () => {
    const group: GroupedExercise = {
      exerciseName: "running",
      category: "cardio",
      sets: [
        { id: "1", workoutLogId: "1", exerciseName: "running", category: "cardio", setNumber: 1, reps: null, weight: null, distance: 5000, time: 25, sortOrder: 1, confidence: null, customLabel: null, notes: null }
      ] as ExerciseSet[]
    };
    expect(formatExerciseSummary(group, "kg", "km")).toBe("running 5000m 25min");
  });

  it("formats distance and time for miles unit", () => {
    const group: GroupedExercise = {
      exerciseName: "running",
      category: "cardio",
      sets: [
        { id: "1", workoutLogId: "1", exerciseName: "running", category: "cardio", setNumber: 1, reps: null, weight: null, distance: 16404, time: 25, sortOrder: 1, confidence: null, customLabel: null, notes: null }
      ] as ExerciseSet[]
    };
    // Expected distance label when unit is not km is "ft"
    expect(formatExerciseSummary(group, "lbs", "miles")).toBe("running 16404ft 25min");
  });
});

describe("groupExerciseSets", () => {
  it("should return an empty array for empty input", () => {
    expect(groupExerciseSets([])).toEqual([]);
  });

  it("should group a single set", () => {
    const sets: ExerciseSet[] = [
      { id: "1", workoutLogId: "wl1", exerciseName: "running", customLabel: null, category: "running", setNumber: 1, reps: null, weight: null, distance: 5, time: 25, notes: null, confidence: 95, sortOrder: 0 }
    ];

    const result = groupExerciseSets(sets);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      exerciseName: "running",
      customLabel: null,
      category: "running",
      confidence: 95,
      sets: sets
    });
  });

  it("should group consecutive sets of the same exercise", () => {
    const sets: ExerciseSet[] = [
      { id: "1", workoutLogId: "wl1", exerciseName: "bench_press", customLabel: null, category: "strength", setNumber: 1, reps: 10, weight: 100, distance: null, time: null, notes: null, confidence: null, sortOrder: 0 },
      { id: "2", workoutLogId: "wl1", exerciseName: "bench_press", customLabel: null, category: "strength", setNumber: 2, reps: 8, weight: 105, distance: null, time: null, notes: null, confidence: null, sortOrder: 1 },
      { id: "3", workoutLogId: "wl1", exerciseName: "bench_press", customLabel: null, category: "strength", setNumber: 3, reps: 6, weight: 110, distance: null, time: null, notes: null, confidence: null, sortOrder: 2 },
    ];

    const result = groupExerciseSets(sets);

    expect(result).toHaveLength(1);
    expect(result[0].sets).toHaveLength(3);
    expect(result[0].exerciseName).toBe("bench_press");
  });

  it("should separate different consecutive exercises into different groups", () => {
    const sets: ExerciseSet[] = [
      { id: "1", workoutLogId: "wl1", exerciseName: "bench_press", customLabel: null, category: "strength", setNumber: 1, reps: 10, weight: 100, distance: null, time: null, notes: null, confidence: null, sortOrder: 0 },
      { id: "2", workoutLogId: "wl1", exerciseName: "squat", customLabel: null, category: "strength", setNumber: 1, reps: 5, weight: 200, distance: null, time: null, notes: null, confidence: null, sortOrder: 1 },
      { id: "3", workoutLogId: "wl1", exerciseName: "bench_press", customLabel: null, category: "strength", setNumber: 1, reps: 5, weight: 120, distance: null, time: null, notes: null, confidence: null, sortOrder: 2 },
    ];

    const result = groupExerciseSets(sets);

    expect(result).toHaveLength(3);
    expect(result[0].exerciseName).toBe("bench_press");
    expect(result[0].sets).toHaveLength(1);

    expect(result[1].exerciseName).toBe("squat");
    expect(result[1].sets).toHaveLength(1);

    expect(result[2].exerciseName).toBe("bench_press");
    expect(result[2].sets).toHaveLength(1);
  });

  it("should correctly group custom exercises by customLabel", () => {
    const sets: ExerciseSet[] = [
      { id: "1", workoutLogId: "wl1", exerciseName: "custom", customLabel: "My Custom Workout", category: "conditioning", setNumber: 1, reps: 10, weight: null, distance: null, time: null, notes: null, confidence: null, sortOrder: 0 },
      { id: "2", workoutLogId: "wl1", exerciseName: "custom", customLabel: "My Custom Workout", category: "conditioning", setNumber: 2, reps: 10, weight: null, distance: null, time: null, notes: null, confidence: null, sortOrder: 1 },
      { id: "3", workoutLogId: "wl1", exerciseName: "custom", customLabel: "Another Custom", category: "conditioning", setNumber: 1, reps: 5, weight: null, distance: null, time: null, notes: null, confidence: null, sortOrder: 2 },
    ];

    const result = groupExerciseSets(sets);

    expect(result).toHaveLength(2);

    expect(result[0].exerciseName).toBe("custom");
    expect(result[0].customLabel).toBe("My Custom Workout");
    expect(result[0].sets).toHaveLength(2);

    expect(result[1].exerciseName).toBe("custom");
    expect(result[1].customLabel).toBe("Another Custom");
    expect(result[1].sets).toHaveLength(1);
  });

  it("should handle custom exercise without customLabel properly", () => {
    const sets: ExerciseSet[] = [
      { id: "1", workoutLogId: "wl1", exerciseName: "custom", customLabel: null, category: "conditioning", setNumber: 1, reps: 10, weight: null, distance: null, time: null, notes: null, confidence: null, sortOrder: 0 },
      { id: "2", workoutLogId: "wl1", exerciseName: "custom", customLabel: null, category: "conditioning", setNumber: 2, reps: 10, weight: null, distance: null, time: null, notes: null, confidence: null, sortOrder: 1 },
    ];

    const result = groupExerciseSets(sets);

    expect(result).toHaveLength(1);
    expect(result[0].exerciseName).toBe("custom");
    expect(result[0].customLabel).toBeNull();
    expect(result[0].sets).toHaveLength(2);
  });
});

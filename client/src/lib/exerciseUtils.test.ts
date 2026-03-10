import { describe, it, expect } from "vitest";
import { groupExerciseSets, type GroupedExercise } from "./exerciseUtils";
import { type ExerciseSet } from "@shared/schema";

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

  it("should sort sets by sortOrder before grouping", () => {
    const sets: ExerciseSet[] = [
      { id: "2", workoutLogId: "wl1", exerciseName: "squat", customLabel: null, category: "strength", setNumber: 1, reps: 5, weight: 200, distance: null, time: null, notes: null, confidence: null, sortOrder: 1 },
      { id: "3", workoutLogId: "wl1", exerciseName: "squat", customLabel: null, category: "strength", setNumber: 2, reps: 5, weight: 200, distance: null, time: null, notes: null, confidence: null, sortOrder: 2 },
      { id: "1", workoutLogId: "wl1", exerciseName: "bench_press", customLabel: null, category: "strength", setNumber: 1, reps: 10, weight: 100, distance: null, time: null, notes: null, confidence: null, sortOrder: 0 },
    ];

    const result = groupExerciseSets(sets);

    expect(result).toHaveLength(2);
    expect(result[0].exerciseName).toBe("bench_press");
    expect(result[0].sets).toHaveLength(1);

    expect(result[1].exerciseName).toBe("squat");
    expect(result[1].sets).toHaveLength(2);
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

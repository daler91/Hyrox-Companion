import { describe, expect,it } from "vitest";

import { expandExercisesToSetRows } from "./workoutService";

describe("expandExercisesToSetRows", () => {
  const workoutLogId = "w1";

  it("returns empty array for empty exercises array", () => {
    const result = expandExercisesToSetRows([], workoutLogId);
    expect(result).toStrictEqual([]);
  });

  it("expands an exercise with an explicit sets array", () => {
    const exercises = [
      {
        exerciseName: "back_squat",
        category: "strength",
        sets: [
          { setNumber: 1, reps: 5, weight: 100 },
          { setNumber: 2, reps: 5, weight: 105 },
        ],
      },
    ];

    const result = expandExercisesToSetRows(exercises, workoutLogId);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      workoutLogId,
      exerciseName: "back_squat",
      category: "strength",
      setNumber: 1,
      reps: 5,
      weight: 100,
      sortOrder: 0,
    });
    expect(result[1]).toMatchObject({
      workoutLogId,
      exerciseName: "back_squat",
      category: "strength",
      setNumber: 2,
      reps: 5,
      weight: 105,
      sortOrder: 1,
    });
  });

  it("expands an exercise using numSets", () => {
    const exercises = [
      {
        exerciseName: "bench_press",
        category: "strength",
        numSets: 3,
        reps: 8,
        weight: 60,
      },
    ];

    const result = expandExercisesToSetRows(exercises, workoutLogId);

    expect(result).toHaveLength(3);
    expect(result[0].setNumber).toBe(1);
    expect(result[0].reps).toBe(8);
    expect(result[0].weight).toBe(60);
    expect(result[0].sortOrder).toBe(0);

    expect(result[1].setNumber).toBe(2);
    expect(result[1].sortOrder).toBe(1);

    expect(result[2].setNumber).toBe(3);
    expect(result[2].sortOrder).toBe(2);
  });

  it("maintains incrementing sortOrder across multiple exercises", () => {
    const exercises = [
      {
        exerciseName: "deadlift",
        category: "strength",
        numSets: 2,
      },
      {
        exerciseName: "pull_ups",
        category: "strength",
        sets: [{ setNumber: 1, reps: 10 }],
      },
    ];

    const result = expandExercisesToSetRows(exercises, workoutLogId);

    expect(result).toHaveLength(3);
    expect(result[0].sortOrder).toBe(0);
    expect(result[1].sortOrder).toBe(1);
    expect(result[2].sortOrder).toBe(2);
    expect(result[2].exerciseName).toBe("pull_ups");
  });

  it("handles missing optional fields by mapping to null", () => {
    const exercises = [
      {
        exerciseName: "push_ups",
        category: "strength",
        sets: [{ setNumber: 1 }],
      },
      {
        exerciseName: "sit_ups",
        category: "strength",
        numSets: 1,
      },
    ];

    const result = expandExercisesToSetRows(exercises, workoutLogId);

    expect(result[0].reps).toBeNull();
    expect(result[0].weight).toBeNull();
    expect(result[0].distance).toBeNull();
    expect(result[0].time).toBeNull();
    expect(result[0].customLabel).toBeNull();
    expect(result[0].confidence).toBeNull();
    expect(result[0].notes).toBeNull();

    expect(result[1].reps).toBeNull();
    expect(result[1].weight).toBeNull();
    expect(result[1].distance).toBeNull();
    expect(result[1].time).toBeNull();
    expect(result[1].customLabel).toBeNull();
    expect(result[1].notes).toBeNull();
  });

  it("handles custom labels properly", () => {
    const exercises = [
      {
        exerciseName: "custom",
        customLabel: "Dumbbell Flys",
        category: "strength",
        numSets: 1,
      },
    ];

    const result = expandExercisesToSetRows(exercises, workoutLogId);

    expect(result).toHaveLength(1);
    expect(result[0].exerciseName).toBe("custom");
    expect(result[0].customLabel).toBe("Dumbbell Flys");
  });

  it("defaults to 1 set if numSets is missing or invalid", () => {
    const exercises = [
      {
        exerciseName: "lunges",
        category: "strength",
      },
    ];

    const result = expandExercisesToSetRows(exercises, workoutLogId);

    expect(result).toHaveLength(1);
    expect(result[0].setNumber).toBe(1);
  });

  it("defaults to setNumber 1 if missing in explicit sets", () => {
    const exercises = [
      {
        exerciseName: "squat",
        category: "strength",
        sets: [{ reps: 5 }],
      },
    ];

    const result = expandExercisesToSetRows(exercises, workoutLogId);

    expect(result).toHaveLength(1);
    expect(result[0].setNumber).toBe(1);
    expect(result[0].reps).toBe(5);
  });

  it("falls back to top-level properties if sets is null", () => {
    const exercises = [
      {
        exerciseName: "deadlift",
        category: "strength",
        sets: null,
        numSets: 2,
        reps: 5,
        weight: 100,
        distance: 10,
        time: 60,
        notes: "Heavy",
      },
    ];

    const result = expandExercisesToSetRows(exercises, workoutLogId);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      setNumber: 1,
      reps: 5,
      weight: 100,
      distance: 10,
      time: 60,
      notes: "Heavy",
    });
    expect(result[1]).toMatchObject({
      setNumber: 2,
      reps: 5,
      weight: 100,
      distance: 10,
      time: 60,
      notes: "Heavy",
    });
  });

  it("falls back to top-level properties if sets is not an array", () => {
    const exercises = [
      {
        exerciseName: "running",
        category: "running",
        sets: "invalid" as unknown as undefined,
        numSets: 1,
        reps: null,
        weight: null,
        distance: 5000,
        time: 1200,
      },
    ];

    const result = expandExercisesToSetRows(exercises, workoutLogId);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      exerciseName: "running",
      setNumber: 1,
      distance: 5000,
      time: 1200,
    });
  });
});

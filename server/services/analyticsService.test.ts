import { describe, it, expect } from "vitest";
import { calculatePersonalRecords, calculateExerciseAnalytics } from "./analyticsService";

function makeSet(overrides: Record<string, any> = {}) {
  return {
    exerciseName: "back_squat",
    category: "strength",
    date: "2026-01-15",
    workoutLogId: "w1",
    setNumber: 1,
    customLabel: null,
    reps: null,
    weight: null,
    distance: null,
    time: null,
    ...overrides,
  };
}

describe("calculatePersonalRecords", () => {
  it("returns empty object for empty input", () => {
    const result = calculatePersonalRecords([]);
    expect(result).toEqual({});
    expect(Object.keys(result).length).toBe(0);
    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();
    // Verify type is preserved correctly
    expect(result).toStrictEqual({});
    // We expect it to strictly match the shape of Record<string, PRRecord> which is an empty object
    expect(typeof result).toBe('object');
  });

  it("tracks maxWeight PR", () => {
    const sets = [
      makeSet({ weight: 100, date: "2026-01-10", workoutLogId: "w1" }),
      makeSet({ weight: 120, date: "2026-01-15", workoutLogId: "w2" }),
      makeSet({ weight: 110, date: "2026-01-20", workoutLogId: "w3" }),
    ];
    const prs = calculatePersonalRecords(sets);
    expect(prs["back_squat"].maxWeight).toEqual({
      value: 120,
      date: "2026-01-15",
      workoutLogId: "w2",
    });
  });

  it("tracks bestTime PR (lower is better)", () => {
    const sets = [
      makeSet({ exerciseName: "easy_run", category: "running", time: 30, date: "2026-01-10", workoutLogId: "w1" }),
      makeSet({ exerciseName: "easy_run", category: "running", time: 25, date: "2026-01-15", workoutLogId: "w2" }),
      makeSet({ exerciseName: "easy_run", category: "running", time: 28, date: "2026-01-20", workoutLogId: "w3" }),
    ];
    const prs = calculatePersonalRecords(sets);
    expect(prs["easy_run"].bestTime).toEqual({
      value: 25,
      date: "2026-01-15",
      workoutLogId: "w2",
    });
  });

  it("tracks maxDistance PR", () => {
    const sets = [
      makeSet({ exerciseName: "skierg", category: "hyrox_station", distance: 1000, workoutLogId: "w1" }),
      makeSet({ exerciseName: "skierg", category: "hyrox_station", distance: 2000, workoutLogId: "w2" }),
    ];
    const prs = calculatePersonalRecords(sets);
    expect(prs["skierg"].maxDistance?.value).toBe(2000);
  });

  it("uses custom:Label key for custom exercises", () => {
    const sets = [
      makeSet({ exerciseName: "custom", customLabel: "KB Press", category: "conditioning", weight: 24 }),
    ];
    const prs = calculatePersonalRecords(sets);
    expect(prs["custom:KB Press"]).toBeDefined();
    expect(prs["custom:KB Press"].maxWeight?.value).toBe(24);
  });

  it("ignores null/undefined fields", () => {
    const sets = [makeSet({ weight: null, distance: null, time: null })];
    const prs = calculatePersonalRecords(sets);
    expect(prs["back_squat"].maxWeight).toBeUndefined();
    expect(prs["back_squat"].maxDistance).toBeUndefined();
    expect(prs["back_squat"].bestTime).toBeUndefined();
  });

  it("ignores time of 0", () => {
    const sets = [makeSet({ time: 0 })];
    const prs = calculatePersonalRecords(sets);
    expect(prs["back_squat"].bestTime).toBeUndefined();
  });

  it("handles multiple exercises independently", () => {
    const sets = [
      makeSet({ exerciseName: "back_squat", weight: 100 }),
      makeSet({ exerciseName: "bench_press", category: "strength", weight: 80 }),
    ];
    const prs = calculatePersonalRecords(sets);
    expect(prs["back_squat"].maxWeight?.value).toBe(100);
    expect(prs["bench_press"].maxWeight?.value).toBe(80);
  });
});

describe("calculateExerciseAnalytics", () => {
  it("returns empty object for empty input", () => {
    const result = calculateExerciseAnalytics([]);
    expect(result).toEqual({});
    expect(Object.keys(result).length).toBe(0);
    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();
    expect(typeof result).toBe('object');
  });

  it("calculates single-day analytics correctly", () => {
    const sets = [
      makeSet({ weight: 100, reps: 8, date: "2026-01-15" }),
      makeSet({ weight: 100, reps: 8, date: "2026-01-15" }),
      makeSet({ weight: 110, reps: 6, date: "2026-01-15" }),
    ];
    const analytics = calculateExerciseAnalytics(sets);
    const day = analytics["back_squat"][0];
    expect(day.date).toBe("2026-01-15");
    expect(day.totalVolume).toBe(100 * 8 + 100 * 8 + 110 * 6);
    expect(day.maxWeight).toBe(110);
    expect(day.totalSets).toBe(3);
    expect(day.totalReps).toBe(22);
  });

  it("sorts multiple days chronologically", () => {
    const sets = [
      makeSet({ weight: 100, reps: 5, date: "2026-01-20" }),
      makeSet({ weight: 90, reps: 5, date: "2026-01-10" }),
    ];
    const analytics = calculateExerciseAnalytics(sets);
    const dates = analytics["back_squat"].map((d) => d.date);
    expect(dates).toEqual(["2026-01-10", "2026-01-20"]);
  });

  it("contributes 0 volume when weight or reps is missing", () => {
    const sets = [
      makeSet({ weight: 100, reps: null, date: "2026-01-15" }),
      makeSet({ weight: null, reps: 10, date: "2026-01-15" }),
    ];
    const analytics = calculateExerciseAnalytics(sets);
    expect(analytics["back_squat"][0].totalVolume).toBe(0);
  });

  it("accumulates distance", () => {
    const sets = [
      makeSet({ exerciseName: "skierg", category: "hyrox_station", distance: 500, date: "2026-01-15" }),
      makeSet({ exerciseName: "skierg", category: "hyrox_station", distance: 500, date: "2026-01-15" }),
    ];
    const analytics = calculateExerciseAnalytics(sets);
    expect(analytics["skierg"][0].totalDistance).toBe(1000);
  });

  it("separates custom exercises by label", () => {
    const sets = [
      makeSet({ exerciseName: "custom", customLabel: "A", weight: 10, reps: 5, date: "2026-01-15" }),
      makeSet({ exerciseName: "custom", customLabel: "B", weight: 20, reps: 5, date: "2026-01-15" }),
    ];
    const analytics = calculateExerciseAnalytics(sets);
    expect(analytics["custom:A"]).toBeDefined();
    expect(analytics["custom:B"]).toBeDefined();
    expect(analytics["custom:A"][0].totalVolume).toBe(50);
    expect(analytics["custom:B"][0].totalVolume).toBe(100);
  });
});

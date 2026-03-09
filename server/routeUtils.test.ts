import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calculateStreak } from "./routeUtils";
import { expandExercisesToSetRows } from "./services/workoutService";

describe("calculateStreak", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0 for empty set", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    expect(calculateStreak(new Set())).toBe(0);
  });

  it("returns 1 when only today is completed", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    expect(calculateStreak(new Set(["2026-01-15"]))).toBe(1);
  });

  it("returns 1 when only yesterday is completed", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    expect(calculateStreak(new Set(["2026-01-14"]))).toBe(1);
  });

  it("returns 2 when today and yesterday are completed", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    expect(calculateStreak(new Set(["2026-01-14", "2026-01-15"]))).toBe(2);
  });

  it("returns 0 when neither today nor yesterday is completed", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    expect(calculateStreak(new Set(["2026-01-13"]))).toBe(0);
  });

  it("stops at gaps (today + 2 days ago = streak of 1)", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    expect(calculateStreak(new Set(["2026-01-15", "2026-01-13"]))).toBe(1);
  });

  it("counts long consecutive streaks", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    const dates = new Set([
      "2026-01-15",
      "2026-01-14",
      "2026-01-13",
      "2026-01-12",
      "2026-01-11",
    ]);
    expect(calculateStreak(dates)).toBe(5);
  });

  it("streak from yesterday counts backwards correctly", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    const dates = new Set(["2026-01-14", "2026-01-13", "2026-01-12"]);
    expect(calculateStreak(dates)).toBe(3);
  });
});

describe("expandExercisesToSetRows", () => {
  it("expands exercise with sets array", () => {
    const exercises = [
      {
        exerciseName: "back_squat",
        category: "strength",
        customLabel: null,
        confidence: 95,
        sets: [
          { setNumber: 1, reps: 8, weight: 100 },
          { setNumber: 2, reps: 8, weight: 100 },
        ],
      },
    ];
    const rows = expandExercisesToSetRows(exercises, "workout-1");
    expect(rows).toHaveLength(2);
    expect(rows[0].workoutLogId).toBe("workout-1");
    expect(rows[0].exerciseName).toBe("back_squat");
    expect(rows[0].setNumber).toBe(1);
    expect(rows[0].reps).toBe(8);
    expect(rows[0].weight).toBe(100);
    expect(rows[0].confidence).toBe(95);
    expect(rows[0].sortOrder).toBe(0);
    expect(rows[1].sortOrder).toBe(1);
  });

  it("uses numSets when no sets array is provided", () => {
    const exercises = [
      {
        exerciseName: "bench_press",
        category: "strength",
        numSets: 3,
        reps: 10,
        weight: 60,
      },
    ];
    const rows = expandExercisesToSetRows(exercises, "workout-1");
    expect(rows).toHaveLength(3);
    expect(rows[0].setNumber).toBe(1);
    expect(rows[1].setNumber).toBe(2);
    expect(rows[2].setNumber).toBe(3);
    expect(rows.every((r) => r.reps === 10 && r.weight === 60)).toBe(true);
  });

  it("defaults to 1 set when no sets array and no numSets", () => {
    const exercises = [
      { exerciseName: "pull_up", category: "strength", reps: 10 },
    ];
    const rows = expandExercisesToSetRows(exercises, "workout-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].setNumber).toBe(1);
  });

  it("propagates customLabel", () => {
    const exercises = [
      {
        exerciseName: "custom",
        category: "conditioning",
        customLabel: "Turkish Getup",
        sets: [{ setNumber: 1, reps: 5, weight: 24 }],
      },
    ];
    const rows = expandExercisesToSetRows(exercises, "workout-1");
    expect(rows[0].customLabel).toBe("Turkish Getup");
  });

  it("increments sortOrder across multiple exercises", () => {
    const exercises = [
      {
        exerciseName: "back_squat",
        category: "strength",
        sets: [{ setNumber: 1, reps: 5 }],
      },
      {
        exerciseName: "bench_press",
        category: "strength",
        sets: [
          { setNumber: 1, reps: 8 },
          { setNumber: 2, reps: 8 },
        ],
      },
    ];
    const rows = expandExercisesToSetRows(exercises, "workout-1");
    expect(rows).toHaveLength(3);
    expect(rows[0].sortOrder).toBe(0);
    expect(rows[1].sortOrder).toBe(1);
    expect(rows[2].sortOrder).toBe(2);
  });

  it("returns empty array for exercise with empty sets array", () => {
    const exercises = [
      {
        exerciseName: "back_squat",
        category: "strength",
        sets: [],
      },
    ];
    const rows = expandExercisesToSetRows(exercises, "workout-1");
    expect(rows).toHaveLength(0);
  });

  it("handles null/undefined values with nullish coalescing", () => {
    const exercises = [
      {
        exerciseName: "easy_run",
        category: "running",
        sets: [{ setNumber: 1, time: 30 }],
      },
    ];
    const rows = expandExercisesToSetRows(exercises, "workout-1");
    expect(rows[0].reps).toBeNull();
    expect(rows[0].weight).toBeNull();
    expect(rows[0].distance).toBeNull();
    expect(rows[0].time).toBe(30);
  });
});

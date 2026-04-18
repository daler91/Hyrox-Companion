import { describe, expect,it } from "vitest";

import { calculateExerciseAnalytics, calculatePersonalRecords, calculateTrainingOverview, computeOverviewStats } from "./analyticsService";

function makeSet(overrides: Record<string, unknown> = {}) {
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
      makeSet({ exerciseName: "skierg", category: "functional", distance: 1000, workoutLogId: "w1" }),
      makeSet({ exerciseName: "skierg", category: "functional", distance: 2000, workoutLogId: "w2" }),
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

  it("estimates 1RM for strength sets using Epley and picks the best across history", () => {
    const sets = [
      // 5x120 => 120 * (1 + 5/30) = 140
      makeSet({ weight: 120, reps: 5, date: "2026-01-15", workoutLogId: "w2" }),
      // 3x135 => 135 * (1 + 3/30) = 148.5 -> new best
      makeSet({ weight: 135, reps: 3, date: "2026-01-20", workoutLogId: "w3" }),
    ];
    const prs = calculatePersonalRecords(sets);
    expect(prs["back_squat"].estimated1RM).toEqual({
      value: 148.5,
      date: "2026-01-20",
      workoutLogId: "w3",
    });
  });

  it("skips e1RM for 1-rep sets (already captured as maxWeight) to avoid duplicate chips", () => {
    // A heavy single renders as maxWeight = 140; emitting an identical 140 kg
    // e1RM chip right next to it is noise (reviewer finding #9).
    const sets = [
      makeSet({ weight: 140, reps: 1, date: "2026-01-10", workoutLogId: "w1" }),
    ];
    const prs = calculatePersonalRecords(sets);
    expect(prs["back_squat"].maxWeight?.value).toBe(140);
    expect(prs["back_squat"].estimated1RM).toBeUndefined();
  });

  it("skips e1RM for non-strength sets and for reps above the reliable Epley range", () => {
    const sets = [
      // Running/functional categories should not produce e1RM
      makeSet({ exerciseName: "skierg", category: "functional", weight: 50, reps: 10 }),
      // Rep-count above cap (15 reps) should be excluded from e1RM
      makeSet({ exerciseName: "back_squat", weight: 100, reps: 15 }),
    ];
    const prs = calculatePersonalRecords(sets);
    expect(prs["skierg"].estimated1RM).toBeUndefined();
    expect(prs["back_squat"].estimated1RM).toBeUndefined();
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
      makeSet({ exerciseName: "skierg", category: "functional", distance: 500, date: "2026-01-15" }),
      makeSet({ exerciseName: "skierg", category: "functional", distance: 500, date: "2026-01-15" }),
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

function makeWorkoutLog(overrides: Record<string, unknown> = {}) {
  return {
    id: "wl1",
    userId: "u1",
    date: "2026-01-15",
    focus: "strength",
    exercises: "",
    mainSummary: null,
    planDayId: null,
    duration: null,
    rpe: null,
    source: "manual" as const,
    distanceMeters: null,
    elevationGain: null,
    avgHeartrate: null,
    maxHeartrate: null,
    avgSpeed: null,
    maxSpeed: null,
    avgCadence: null,
    avgWatts: null,
    sufferScore: null,
    calories: null,
    stravaActivityId: null,
    ...overrides,
  };
}

describe("calculateTrainingOverview", () => {
  it("returns empty overview for no data", () => {
    const result = calculateTrainingOverview([], []);
    expect(result.weeklySummaries).toEqual([]);
    expect(result.workoutDates).toEqual([]);
    expect(result.categoryTotals).toEqual({});
    expect(result.stationCoverage).toHaveLength(9); // 8 stations + running
    expect(result.stationCoverage.every((s) => s.lastTrained === null)).toBe(true);
  });

  it("groups workouts into weekly summaries", () => {
    const logs = [
      makeWorkoutLog({ id: "w1", date: "2026-01-13", duration: 60, rpe: 7 }), // Monday
      makeWorkoutLog({ id: "w2", date: "2026-01-14", duration: 45, rpe: 6 }), // Tuesday
      makeWorkoutLog({ id: "w3", date: "2026-01-20", duration: 50, rpe: 8 }), // Next Monday
    ];
    const result = calculateTrainingOverview(logs, []);
    expect(result.weeklySummaries).toHaveLength(2);

    const week1 = result.weeklySummaries[0];
    expect(week1.weekStart).toBe("2026-01-12"); // Monday of that week
    expect(week1.workoutCount).toBe(2);
    expect(week1.totalDuration).toBe(105);
    expect(week1.avgRpe).toBe(6.5);

    const week2 = result.weeklySummaries[1];
    expect(week2.workoutCount).toBe(1);
  });

  it("collects workout dates", () => {
    const logs = [
      makeWorkoutLog({ id: "w1", date: "2026-01-13" }),
      makeWorkoutLog({ id: "w2", date: "2026-01-15" }),
    ];
    const result = calculateTrainingOverview(logs, []);
    expect(result.workoutDates).toEqual(["2026-01-13", "2026-01-15"]);
  });

  it("computes category totals from exercise sets", () => {
    const sets = [
      makeSet({ exerciseName: "back_squat", category: "strength", workoutLogId: "w1", date: "2026-01-13" }),
      makeSet({ exerciseName: "back_squat", category: "strength", workoutLogId: "w1", date: "2026-01-13" }),
      makeSet({ exerciseName: "easy_run", category: "running", workoutLogId: "w2", date: "2026-01-14" }),
    ];
    const result = calculateTrainingOverview([], sets);
    expect(result.categoryTotals["strength"]).toEqual({ count: 1, totalSets: 2 });
    expect(result.categoryTotals["running"]).toEqual({ count: 1, totalSets: 1 });
  });

  it("detects station coverage for Hyrox exercises", () => {
    const sets = [
      makeSet({ exerciseName: "skierg", category: "functional", date: "2026-03-25" }),
      makeSet({ exerciseName: "wall_balls", category: "functional", date: "2026-03-20" }),
    ];
    const result = calculateTrainingOverview([], sets);

    const skierg = result.stationCoverage.find((s) => s.station === "skierg");
    expect(skierg?.lastTrained).toBe("2026-03-25");
    expect(skierg?.daysSince).toBeTypeOf("number");

    const wallBalls = result.stationCoverage.find((s) => s.station === "wall_balls");
    expect(wallBalls?.lastTrained).toBe("2026-03-20");

    const sledPush = result.stationCoverage.find((s) => s.station === "sled_push");
    expect(sledPush?.lastTrained).toBeNull();
    expect(sledPush?.daysSince).toBeNull();
  });

  it("handles null RPE gracefully", () => {
    const logs = [
      makeWorkoutLog({ id: "w1", date: "2026-01-13", rpe: null }),
      makeWorkoutLog({ id: "w2", date: "2026-01-14", rpe: null }),
    ];
    const result = calculateTrainingOverview(logs, []);
    expect(result.weeklySummaries[0].avgRpe).toBeNull();
  });

  it("sorts weekly summaries chronologically", () => {
    const logs = [
      makeWorkoutLog({ id: "w1", date: "2026-02-10" }),
      makeWorkoutLog({ id: "w2", date: "2026-01-06" }),
      makeWorkoutLog({ id: "w3", date: "2026-01-20" }),
    ];
    const result = calculateTrainingOverview(logs, []);
    const weekStarts = result.weeklySummaries.map((w) => w.weekStart);
    const sorted = [...weekStarts].sort((a, b) => {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });
    expect(weekStarts).toEqual(sorted);
  });

  it("includes currentStats aggregated from the weekly summaries", () => {
    const logs = [
      makeWorkoutLog({ id: "w1", date: "2026-01-13", duration: 60, rpe: 7 }),
      makeWorkoutLog({ id: "w2", date: "2026-01-14", duration: 40, rpe: 5 }),
      makeWorkoutLog({ id: "w3", date: "2026-01-20", duration: 50, rpe: 8 }),
    ];
    const result = calculateTrainingOverview(logs, []);

    expect(result.currentStats).toEqual({
      totalWorkouts: 3,
      avgPerWeek: 1.5, // 3 workouts / 2 weeks
      totalDuration: 150,
      avgDuration: 50, // 150 / 3
      avgRpe: 7, // week1 avg=6, week2 avg=8 → (6+8)/2
    });
  });

  it("omits previousStats when previousWorkoutLogs is not supplied", () => {
    const logs = [makeWorkoutLog({ id: "w1", date: "2026-01-13", duration: 60, rpe: 7 })];
    const result = calculateTrainingOverview(logs, []);
    expect(result.previousStats).toBeUndefined();
  });

  it("computes previousStats from the supplied previous-period logs", () => {
    const currentLogs = [
      makeWorkoutLog({ id: "c1", date: "2026-02-02", duration: 60, rpe: 7 }),
      makeWorkoutLog({ id: "c2", date: "2026-02-04", duration: 50, rpe: 6 }),
    ];
    const previousLogs = [
      makeWorkoutLog({ id: "p1", date: "2026-01-26", duration: 40, rpe: 5 }),
    ];
    const result = calculateTrainingOverview(currentLogs, [], previousLogs);

    expect(result.currentStats.totalWorkouts).toBe(2);
    expect(result.previousStats).toBeDefined();
    expect(result.previousStats?.totalWorkouts).toBe(1);
    expect(result.previousStats?.totalDuration).toBe(40);
    expect(result.previousStats?.avgRpe).toBe(5);
  });

  it("treats an empty previous period as all-zeroes (not undefined)", () => {
    const result = calculateTrainingOverview([], [], []);
    expect(result.previousStats).toEqual({
      totalWorkouts: 0,
      avgPerWeek: 0,
      totalDuration: 0,
      avgDuration: 0,
      avgRpe: null,
    });
  });
});

describe("computeOverviewStats", () => {
  it("returns zeroes for an empty input", () => {
    expect(computeOverviewStats([])).toEqual({
      totalWorkouts: 0,
      avgPerWeek: 0,
      totalDuration: 0,
      avgDuration: 0,
      avgRpe: null,
    });
  });

  it("rounds avgPerWeek to one decimal place", () => {
    const weeks = [
      { weekStart: "2026-01-05", workoutCount: 4, totalDuration: 0, avgRpe: null, categoryBreakdown: {} },
      { weekStart: "2026-01-12", workoutCount: 3, totalDuration: 0, avgRpe: null, categoryBreakdown: {} },
      { weekStart: "2026-01-19", workoutCount: 3, totalDuration: 0, avgRpe: null, categoryBreakdown: {} },
    ];
    // 10 / 3 = 3.333... → rounded to 3.3
    expect(computeOverviewStats(weeks).avgPerWeek).toBe(3.3);
  });

  it("only averages weeks that had at least one RPE entry", () => {
    const weeks = [
      { weekStart: "2026-01-05", workoutCount: 2, totalDuration: 0, avgRpe: 8, categoryBreakdown: {} },
      { weekStart: "2026-01-12", workoutCount: 2, totalDuration: 0, avgRpe: null, categoryBreakdown: {} },
      { weekStart: "2026-01-19", workoutCount: 2, totalDuration: 0, avgRpe: 6, categoryBreakdown: {} },
    ];
    // avg over the 2 weeks with RPE, not all 3
    expect(computeOverviewStats(weeks).avgRpe).toBe(7);
  });

  it("returns avgDuration of 0 when no workouts were logged", () => {
    const weeks = [
      { weekStart: "2026-01-05", workoutCount: 0, totalDuration: 0, avgRpe: null, categoryBreakdown: {} },
    ];
    expect(computeOverviewStats(weeks).avgDuration).toBe(0);
  });
});

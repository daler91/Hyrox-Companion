import type { ExerciseSet, WorkoutLog } from "@shared/schema";
import { describe, expect, it } from "vitest";

import type { ExerciseSetWithDate } from "./analyticsService";
import { countPersonalRecordsInRange, findPersonalRecordAchievements } from "./personalRecordAchievements";

function makeSet(overrides: Partial<ExerciseSetWithDate> = {}): ExerciseSetWithDate {
  return {
    id: "set-1",
    workoutLogId: "prior-1",
    planDayId: null,
    exerciseName: "back_squat",
    customLabel: null,
    category: "strength",
    setNumber: 1,
    reps: null,
    weight: null,
    distance: null,
    time: null,
    plannedReps: null,
    plannedWeight: null,
    plannedDistance: null,
    plannedTime: null,
    notes: null,
    confidence: null,
    sortOrder: 0,
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
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: new Date("2026-05-01T00:00:00Z"),
    date: "2026-05-01",
    ...overrides,
  };
}

function makeWorkout(exerciseSets: ExerciseSet[]): WorkoutLog & { exerciseSets: ExerciseSet[] } {
  return {
    id: "created-1",
    userId: "user-1",
    planId: null,
    planDayId: null,
    title: "Strength",
    date: "2026-05-20",
    focus: "Strength",
    mainWorkout: "Squat",
    accessory: null,
    notes: null,
    duration: null,
    rpe: null,
    source: "manual",
    sourceId: null,
    prescribedMainWorkout: null,
    prescribedAccessory: null,
    prescribedNotes: null,
    compliancePct: null,
    adherence: null,
    calories: null,
    distanceMeters: null,
    elevationGain: null,
    avgHeartrate: null,
    maxHeartrate: null,
    avgSpeed: null,
    maxSpeed: null,
    avgCadence: null,
    avgWatts: null,
    sufferScore: null,
    createdAt: new Date("2026-05-20T00:00:00Z"),
    updatedAt: new Date("2026-05-20T00:00:00Z"),
    exerciseSets,
  };
}

describe("findPersonalRecordAchievements", () => {
  it("reports only improvements over a prior best", () => {
    const priorSets = [
      makeSet({ weight: 100, reps: 5, workoutLogId: "prior-1", date: "2026-05-01" }),
      makeSet({ weight: 95, reps: 8, workoutLogId: "prior-2", date: "2026-05-07" }),
    ];
    const createdSet = makeSet({
      id: "set-new",
      workoutLogId: "created-1",
      weight: 105,
      reps: 5,
      date: "2026-05-20",
    }) as ExerciseSet;

    const achievements = findPersonalRecordAchievements(priorSets, makeWorkout([createdSet]));

    expect(achievements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseKey: "back_squat",
          metric: "maxWeight",
          metricLabel: "Max weight",
          value: 105,
          previousValue: 100,
          workoutLogId: "created-1",
        }),
        expect.objectContaining({
          metric: "estimated1RM",
          value: 122.5,
          previousValue: 120.3,
        }),
      ]),
    );
  });

  it("does not report first-ever records", () => {
    const createdSet = makeSet({
      id: "set-new",
      workoutLogId: "created-1",
      exerciseName: "skierg",
      category: "functional",
      distance: 1000,
      date: "2026-05-20",
    }) as ExerciseSet;

    expect(findPersonalRecordAchievements([], makeWorkout([createdSet]))).toEqual([]);
  });

  it("treats lower time as an improvement", () => {
    const priorSets = [
      makeSet({
        exerciseName: "easy_run",
        category: "running",
        time: 25,
        workoutLogId: "prior-1",
      }),
    ];
    const createdSet = makeSet({
      id: "set-new",
      workoutLogId: "created-1",
      exerciseName: "easy_run",
      category: "running",
      time: 22,
      date: "2026-05-20",
    }) as ExerciseSet;

    expect(findPersonalRecordAchievements(priorSets, makeWorkout([createdSet]))).toEqual([
      expect.objectContaining({
        exerciseKey: "easy_run",
        metric: "bestTime",
        value: 22,
        previousValue: 25,
      }),
    ]);
  });
});

describe("countPersonalRecordsInRange", () => {
  const run = (overrides: Partial<ExerciseSetWithDate>) =>
    makeSet({ exerciseName: "easy_run", category: "running", ...overrides });

  it("counts a metric whose in-range best beats the prior best", () => {
    const sets = [
      run({ time: 30, workoutLogId: "before", date: "2026-05-01" }),
      run({ time: 22, workoutLogId: "in", date: "2026-05-05" }),
    ];

    expect(countPersonalRecordsInRange(sets, "2026-05-04", "2026-05-10")).toBe(1);
  });

  it("does not count a first-ever record (no prior best to beat)", () => {
    const sets = [
      makeSet({ exerciseName: "skierg", category: "functional", distance: 1000, date: "2026-05-05" }),
    ];

    expect(countPersonalRecordsInRange(sets, "2026-05-04", "2026-05-10")).toBe(0);
  });

  it("does not count a record that was set before the range", () => {
    const sets = [
      run({ time: 30, workoutLogId: "old", date: "2026-04-20" }),
      run({ time: 22, workoutLogId: "pr-before-range", date: "2026-05-01" }),
      run({ time: 24, workoutLogId: "in-but-slower", date: "2026-05-05" }),
    ];

    // The 22-min PR predates the window; the in-range run (24) is slower than it.
    expect(countPersonalRecordsInRange(sets, "2026-05-04", "2026-05-10")).toBe(0);
  });

  it("collapses repeated improvements of one metric within the range to a single PR", () => {
    const sets = [
      run({ time: 30, workoutLogId: "before", date: "2026-04-20" }),
      run({ time: 25, workoutLogId: "in-1", date: "2026-05-05" }),
      run({ time: 22, workoutLogId: "in-2", date: "2026-05-07" }),
    ];

    expect(countPersonalRecordsInRange(sets, "2026-05-04", "2026-05-10")).toBe(1);
  });

  it("ignores sets logged after the range", () => {
    const sets = [
      run({ time: 30, workoutLogId: "before", date: "2026-05-01" }),
      run({ time: 20, workoutLogId: "after-range", date: "2026-05-20" }),
    ];

    // The only faster run happened after the window, so it is not a PR "this week".
    expect(countPersonalRecordsInRange(sets, "2026-05-04", "2026-05-10")).toBe(0);
  });

  it("counts both maxWeight and estimated-1RM for a heavier strength lift", () => {
    const sets = [
      makeSet({ exerciseName: "back_squat", category: "strength", weight: 100, reps: 5, workoutLogId: "before", date: "2026-05-01" }),
      makeSet({ exerciseName: "back_squat", category: "strength", weight: 110, reps: 5, workoutLogId: "in", date: "2026-05-06" }),
    ];

    expect(countPersonalRecordsInRange(sets, "2026-05-04", "2026-05-10")).toBe(2);
  });
});

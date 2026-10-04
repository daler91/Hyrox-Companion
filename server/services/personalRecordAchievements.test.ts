import type { ExerciseSet, WorkoutLog } from "@shared/schema";
import { describe, expect, it } from "vitest";

import type { ExerciseSetWithDate } from "./analyticsService";
import { findPersonalRecordAchievements } from "./personalRecordAchievements";

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
    // run_1k's catalogue entry fixes the distance, so its bare clock is a result.
    const priorSets = [
      makeSet({
        exerciseName: "run_1k",
        category: "running",
        time: 4.5,
        workoutLogId: "prior-1",
      }),
    ];
    const createdSet = makeSet({
      id: "set-new",
      workoutLogId: "created-1",
      exerciseName: "run_1k",
      category: "running",
      time: 4.2,
      date: "2026-05-20",
    }) as ExerciseSet;

    expect(findPersonalRecordAchievements(priorSets, makeWorkout([createdSet]))).toEqual([
      expect.objectContaining({
        exerciseKey: "run_1k",
        metric: "bestTime",
        value: 4.2,
        previousValue: 4.5,
      }),
    ]);
  });

  it("does not call a shorter run logged by time alone a PR (C1)", () => {
    // A bare time on distance-carrying work is how long the athlete went, not
    // how fast: a 20 min easy run is a shorter run than a 30 min one.
    const priorSets = [
      makeSet({ exerciseName: "easy_run", category: "running", time: 30, workoutLogId: "prior-1" }),
      makeSet({ exerciseName: "easy_run", category: "running", time: 45, workoutLogId: "prior-2" }),
    ];
    const createdSet = makeSet({
      id: "set-new",
      workoutLogId: "created-1",
      exerciseName: "easy_run",
      category: "running",
      time: 20,
      date: "2026-05-20",
    }) as ExerciseSet;

    expect(findPersonalRecordAchievements(priorSets, makeWorkout([createdSet]))).toEqual([]);
  });

  it("treats a LONGER hold as the improvement for isometric exercises", () => {
    const priorSets = [
      makeSet({
        exerciseName: "plank",
        category: "strength",
        time: 60,
        workoutLogId: "prior-1",
      }),
    ];
    const createdSet = makeSet({
      id: "set-new",
      workoutLogId: "created-1",
      exerciseName: "plank",
      category: "strength",
      time: 90,
      date: "2026-05-20",
    }) as ExerciseSet;

    expect(findPersonalRecordAchievements(priorSets, makeWorkout([createdSet]))).toEqual([
      expect.objectContaining({
        exerciseKey: "plank",
        metric: "bestTime",
        value: 90,
        previousValue: 60,
      }),
    ]);
  });

  it("does not celebrate a shorter hold as a PR for isometric exercises", () => {
    const priorSets = [
      makeSet({
        exerciseName: "plank",
        category: "strength",
        time: 90,
        workoutLogId: "prior-1",
      }),
    ];
    const createdSet = makeSet({
      id: "set-new",
      workoutLogId: "created-1",
      exerciseName: "plank",
      category: "strength",
      time: 60,
      date: "2026-05-20",
    }) as ExerciseSet;

    expect(findPersonalRecordAchievements(priorSets, makeWorkout([createdSet]))).toEqual([]);
  });

  it("treats a LONGER hold as the improvement for a custom-labelled isometric exercise (audit H4)", () => {
    // exerciseName is "custom" for every custom-labelled set — only customLabel
    // says which exercise it actually is. Before H4, isImprovement only saw
    // exerciseName, so this fell through to faster-is-better and a shorter
    // custom "Plank" was celebrated as a PR.
    const priorSets = [
      makeSet({
        exerciseName: "custom",
        customLabel: "Plank",
        category: "strength",
        time: 60,
        workoutLogId: "prior-1",
      }),
    ];
    const createdSet = makeSet({
      id: "set-new",
      workoutLogId: "created-1",
      exerciseName: "custom",
      customLabel: "Plank",
      category: "strength",
      time: 90,
      date: "2026-05-20",
    }) as ExerciseSet;

    expect(findPersonalRecordAchievements(priorSets, makeWorkout([createdSet]))).toEqual([
      expect.objectContaining({
        exerciseKey: "custom:Plank",
        metric: "bestTime",
        value: 90,
        previousValue: 60,
      }),
    ]);
  });

  it("does not celebrate a shorter hold as a PR for a custom-labelled isometric exercise (audit H4)", () => {
    const priorSets = [
      makeSet({
        exerciseName: "custom",
        customLabel: "Plank",
        category: "strength",
        time: 90,
        workoutLogId: "prior-1",
      }),
    ];
    const createdSet = makeSet({
      id: "set-new",
      workoutLogId: "created-1",
      exerciseName: "custom",
      customLabel: "Plank",
      category: "strength",
      time: 60,
      date: "2026-05-20",
    }) as ExerciseSet;

    expect(findPersonalRecordAchievements(priorSets, makeWorkout([createdSet]))).toEqual([]);
  });

  it("still treats faster as the improvement for a custom label that doesn't resolve to an isometric hold", () => {
    // "Sled Push" has no isometric direction override, so the faster-is-better
    // default applies — same as an unlabelled timed exercise.
    const priorSets = [
      makeSet({
        exerciseName: "custom",
        customLabel: "Sled Push 50m",
        category: "functional",
        time: 40,
        workoutLogId: "prior-1",
      }),
    ];
    const createdSet = makeSet({
      id: "set-new",
      workoutLogId: "created-1",
      exerciseName: "custom",
      customLabel: "Sled Push 50m",
      category: "functional",
      time: 32,
      date: "2026-05-20",
    }) as ExerciseSet;

    expect(findPersonalRecordAchievements(priorSets, makeWorkout([createdSet]))).toEqual([
      expect.objectContaining({
        exerciseKey: "custom:Sled Push 50m",
        metric: "bestTime",
        value: 32,
        previousValue: 40,
      }),
    ]);
  });
});

// C1 (CODEBASE_ANALYSIS_2026-10-03): the raw minimum time per exercise made
// every shorter piece a "New PR". A time now only beats a time for the same
// distance, or for timed work sized by reps, the same reps.
describe("findPersonalRecordAchievements — best time compares like-for-like work (C1)", () => {
  const ski = (overrides: Partial<ExerciseSetWithDate>) =>
    makeSet({ exerciseName: "skierg", category: "functional", ...overrides });
  const priorSkiErg = [ski({ distance: 1000, time: 4, workoutLogId: "prior-1" })];

  it("does not celebrate 250 m in 0:54 as faster than 1000 m in 4:00", () => {
    const created = makeWorkout([
      ski({ id: "new-1", workoutLogId: "created-1", distance: 250, time: 0.9, date: "2026-05-20" }),
    ]);

    expect(findPersonalRecordAchievements(priorSkiErg, created)).toEqual([]);
  });

  it("celebrates a faster 1000 m", () => {
    const created = makeWorkout([
      ski({ id: "new-1", workoutLogId: "created-1", distance: 1000, time: 3.8, date: "2026-05-20" }),
    ]);

    expect(findPersonalRecordAchievements(priorSkiErg, created)).toEqual([
      expect.objectContaining({ exerciseKey: "skierg", metric: "bestTime", value: 3.8, previousValue: 4 }),
    ]);
  });

  it("judges a faster piece against its own distance when the session mixes distances", () => {
    const prior = [
      ...priorSkiErg,
      ski({ distance: 250, time: 0.85, workoutLogId: "prior-2", date: "2026-05-07" }),
    ];
    const created = makeWorkout([
      ski({ id: "new-1", workoutLogId: "created-1", distance: 250, time: 0.9, date: "2026-05-20" }),
      ski({ id: "new-2", workoutLogId: "created-1", distance: 1000, time: 3.9, date: "2026-05-20" }),
    ]);

    // The 250 m is slower than the 250 m best; the 1000 m beats the 1000 m best.
    expect(findPersonalRecordAchievements(prior, created)).toEqual([
      expect.objectContaining({ metric: "bestTime", value: 3.9, previousValue: 4 }),
    ]);
  });

  it("matches distances through their unit stamps", () => {
    const created = makeWorkout([
      // 3,280 ft is 999.7 m: the same 1000 m, logged after a switch to miles.
      ski({ id: "new-1", workoutLogId: "created-1", distance: 3280, distanceUnit: "ft", time: 3.8, date: "2026-05-20" }),
    ]);
    const prior = [ski({ distance: 1000, distanceUnit: "m", time: 4, workoutLogId: "prior-1" })];

    expect(findPersonalRecordAchievements(prior, created, { distanceUnit: "miles" })).toEqual([
      expect.objectContaining({ metric: "bestTime", value: 3.8, previousValue: 4 }),
    ]);
  });

  it("does not compare a time with no distance against times that have one", () => {
    const created = makeWorkout([
      ski({ id: "new-1", workoutLogId: "created-1", distance: null, time: 2, date: "2026-05-20" }),
    ]);

    expect(findPersonalRecordAchievements(priorSkiErg, created)).toEqual([]);
  });

  it("compares rep-sized timed work only at the same reps", () => {
    const balls = (overrides: Partial<ExerciseSetWithDate>) =>
      makeSet({ exerciseName: "wall_balls", category: "functional", ...overrides });
    const prior = [balls({ reps: 100, time: 5, workoutLogId: "prior-1" })];

    const fewerReps = makeWorkout([balls({ id: "new-1", workoutLogId: "created-1", reps: 50, time: 2.5, date: "2026-05-20" })]);
    expect(findPersonalRecordAchievements(prior, fewerReps).filter((a) => a.metric === "bestTime")).toEqual([]);

    const sameReps = makeWorkout([balls({ id: "new-1", workoutLogId: "created-1", reps: 100, time: 4.5, date: "2026-05-20" })]);
    expect(findPersonalRecordAchievements(prior, sameReps).filter((a) => a.metric === "bestTime")).toEqual([
      expect.objectContaining({ value: 4.5, previousValue: 5 }),
    ]);
  });
});

describe("findPersonalRecordAchievements — unit stamps (audit L4)", () => {
  const LB_ATHLETE = { weightUnit: "lbs", distanceUnit: "miles" };

  it("does not celebrate a 150 lb squat as a PR over a 100 kg (220 lb) history after a kg→lbs switch", () => {
    const priorSets = [makeSet({ weight: 100, weightUnit: "kg", reps: 1, workoutLogId: "prior-1" })];
    const created = makeWorkout([
      makeSet({ id: "new-1", workoutLogId: "created-1", weight: 150, weightUnit: "lbs", reps: 1 }),
    ]);

    // Raw comparison (150 > 100) used to fire "Max weight PR" here.
    expect(findPersonalRecordAchievements(priorSets, created, LB_ATHLETE)).toEqual([]);
  });

  it("still celebrates a genuine improvement measured in one unit", () => {
    const priorSets = [makeSet({ weight: 100, weightUnit: "kg", reps: 1, workoutLogId: "prior-1" })];
    const created = makeWorkout([
      makeSet({ id: "new-1", workoutLogId: "created-1", weight: 230, weightUnit: "lbs", reps: 1 }),
    ]);

    const achievements = findPersonalRecordAchievements(priorSets, created, LB_ATHLETE);
    expect(achievements.map((a) => a.metric)).toEqual(["maxWeight"]);
    // Both sides are reported in the athlete's current unit (lbs).
    expect(achievements[0]).toMatchObject({ value: 230, previousValue: 220 });
  });
});

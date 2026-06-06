import { describe, expect, it } from "vitest";

import { makeExerciseSet as makeSet, makeTimelineEntry as makeEntry } from "./testFixtures";
import {
  calculateTrainingStats,
  collectRecentWorkouts,
  getExerciseBreakdown,
  getStructuredExerciseStats,
} from "./trainingStats";
import type { TimelineEntry } from "./types";

const COMPLETED = "completed" as const;
const PLANNED = "planned" as const;
const MISSED = "missed" as const;
const SKIPPED = "skipped" as const;

const BACK_SQUAT = "back_squat";
const RUNNING = "running";
const ROWING = "rowing";
const DATE_A = "2026-01-01";

describe("calculateTrainingStats", () => {
  it("returns all-zero stats for an empty timeline", () => {
    const stats = calculateTrainingStats([]);
    expect(stats).toEqual({
      completedWorkouts: 0,
      plannedWorkouts: 0,
      missedWorkouts: 0,
      skippedWorkouts: 0,
      totalWorkouts: 0,
      completionRate: 0,
      completedDates: new Set(),
    });
  });

  it("counts each status bucket and totals them", () => {
    const stats = calculateTrainingStats([
      makeEntry({ status: COMPLETED, date: "2026-01-01" }),
      makeEntry({ status: COMPLETED, date: "2026-01-02" }),
      makeEntry({ status: COMPLETED, date: "2026-01-03" }),
      makeEntry({ status: PLANNED }),
      makeEntry({ status: PLANNED }),
      makeEntry({ status: MISSED }),
      makeEntry({ status: SKIPPED }),
    ]);
    expect(stats.completedWorkouts).toBe(3);
    expect(stats.plannedWorkouts).toBe(2);
    expect(stats.missedWorkouts).toBe(1);
    expect(stats.skippedWorkouts).toBe(1);
    expect(stats.totalWorkouts).toBe(7);
  });

  it("excludes planned workouts from the completion-rate denominator", () => {
    // denominator = completed + missed + skipped = 3; planned is ignored.
    const stats = calculateTrainingStats([
      makeEntry({ status: COMPLETED }),
      makeEntry({ status: COMPLETED }),
      makeEntry({ status: COMPLETED }),
      makeEntry({ status: PLANNED }),
      makeEntry({ status: PLANNED }),
      makeEntry({ status: PLANNED }),
    ]);
    expect(stats.completionRate).toBe(100);
  });

  it("rounds the completion rate to the nearest whole percent", () => {
    // 2 completed of 3 counted = 66.67% -> 67.
    const stats = calculateTrainingStats([
      makeEntry({ status: COMPLETED }),
      makeEntry({ status: COMPLETED }),
      makeEntry({ status: MISSED }),
    ]);
    expect(stats.completionRate).toBe(67);
  });

  it("reports a 0 completion rate when the denominator is zero", () => {
    const stats = calculateTrainingStats([
      makeEntry({ status: PLANNED }),
      makeEntry({ status: PLANNED }),
    ]);
    expect(stats.completionRate).toBe(0);
  });

  it("collects de-duplicated completed dates", () => {
    const stats = calculateTrainingStats([
      makeEntry({ status: COMPLETED, date: "2026-01-01" }),
      makeEntry({ status: COMPLETED, date: "2026-01-01" }),
      makeEntry({ status: COMPLETED, date: "2026-01-02" }),
    ]);
    expect(stats.completedDates).toEqual(new Set(["2026-01-01", "2026-01-02"]));
  });

  it("counts a completed workout with a blank date but omits it from completedDates", () => {
    const stats = calculateTrainingStats([
      makeEntry({ status: COMPLETED, date: DATE_A }),
      makeEntry({ status: COMPLETED, date: "" }),
    ]);
    expect(stats.completedWorkouts).toBe(2);
    expect(stats.completedDates).toEqual(new Set([DATE_A]));
  });

  it("silently ignores a status outside the known set (untravelled fallthrough)", () => {
    const stats = calculateTrainingStats([
      makeEntry({ status: COMPLETED }),
      // A future/unknown status lands in no bucket and is excluded from the total.
      { ...makeEntry(), status: "in_progress" as unknown as TimelineEntry["status"] },
    ]);
    expect(stats.completedWorkouts).toBe(1);
    expect(stats.totalWorkouts).toBe(1);
  });
});

describe("getExerciseBreakdown", () => {
  it("counts a single functional exercise found in the focus", () => {
    expect(getExerciseBreakdown([makeEntry({ focus: "Morning running drills" })])).toEqual({
      [RUNNING]: 1,
    });
  });

  it("counts each distinct functional exercise in one focus", () => {
    expect(getExerciseBreakdown([makeEntry({ focus: "running rowing wall balls" })])).toEqual({
      [RUNNING]: 1,
      [ROWING]: 1,
      "wall balls": 1,
    });
  });

  it("de-duplicates repeated matches within a focus (case-insensitive)", () => {
    expect(
      getExerciseBreakdown([makeEntry({ focus: "Running running RUNNING intervals" })]),
    ).toEqual({
      [RUNNING]: 1,
    });
  });

  it("distinguishes overlapping prefixes like 'sled push' and 'sled pull'", () => {
    expect(getExerciseBreakdown([makeEntry({ focus: "sled push then sled pull" })])).toEqual({
      "sled push": 1,
      "sled pull": 1,
    });
  });

  it("uses the whole focus as the key when no functional exercise matches", () => {
    expect(getExerciseBreakdown([makeEntry({ focus: "Yoga Flow" })])).toEqual({ "Yoga Flow": 1 });
  });

  it("suppresses the whole-focus fallback once any functional exercise matches", () => {
    expect(getExerciseBreakdown([makeEntry({ focus: "Easy running recovery" })])).toEqual({
      [RUNNING]: 1,
    });
  });

  it("accumulates the same exercise across multiple completed entries", () => {
    expect(
      getExerciseBreakdown([makeEntry({ focus: RUNNING }), makeEntry({ focus: RUNNING })]),
    ).toEqual({ [RUNNING]: 2 });
  });

  it("ignores non-completed entries", () => {
    expect(getExerciseBreakdown([makeEntry({ status: PLANNED, focus: RUNNING })])).toEqual({});
  });

  it("ignores completed entries with an empty focus", () => {
    expect(getExerciseBreakdown([makeEntry({ focus: "" })])).toEqual({});
  });

  it("resets the shared regex between entries so a later match is not skipped", () => {
    // Regression guard for the module-level global regex's lastIndex. If the
    // reset were missing, "Rowing" would miss its match and fall back to the
    // original-case key "Rowing" instead of the lowercased "rowing".
    expect(
      getExerciseBreakdown([
        makeEntry({ focus: "long warmup before running" }),
        makeEntry({ focus: "Rowing" }),
      ]),
    ).toEqual({ [RUNNING]: 1, [ROWING]: 1 });
  });

  it("keeps results isolated across separate calls", () => {
    expect(getExerciseBreakdown([makeEntry({ focus: RUNNING })])).toEqual({ [RUNNING]: 1 });
    expect(getExerciseBreakdown([makeEntry({ focus: ROWING })])).toEqual({ [ROWING]: 1 });
  });
});

describe("collectRecentWorkouts", () => {
  it("returns an empty list for an empty timeline", () => {
    expect(collectRecentWorkouts([])).toEqual([]);
  });

  it("includes only completed entries that have a date", () => {
    const recent = collectRecentWorkouts([
      makeEntry({ status: COMPLETED, date: "2026-02-01" }),
      makeEntry({ status: PLANNED, date: "2026-02-02" }),
      makeEntry({ status: MISSED, date: "2026-02-03" }),
      makeEntry({ status: SKIPPED, date: "2026-02-04" }),
      makeEntry({ status: COMPLETED, date: "" }),
    ]);
    expect(recent).toHaveLength(1);
    expect(recent[0].date).toBe("2026-02-01");
  });

  it("sorts completed workouts by date descending", () => {
    const recent = collectRecentWorkouts([
      makeEntry({ date: "2026-01-01" }),
      makeEntry({ date: "2026-03-01" }),
      makeEntry({ date: "2026-02-01" }),
    ]);
    expect(recent.map((w) => w.date)).toEqual(["2026-03-01", "2026-02-01", "2026-01-01"]);
  });

  it("preserves input order for entries sharing the same date (stable sort)", () => {
    const recent = collectRecentWorkouts([
      makeEntry({ date: DATE_A, focus: "first" }),
      makeEntry({ date: DATE_A, focus: "second" }),
    ]);
    expect(recent.map((w) => w.focus)).toEqual(["first", "second"]);
  });

  it("defaults empty focus and mainWorkout to empty strings and maps notes to athleteNote", () => {
    const recent = collectRecentWorkouts([
      makeEntry({ focus: "", mainWorkout: "", notes: "felt good", rpe: 8, duration: 60 }),
    ]);
    expect(recent[0]).toMatchObject({
      focus: "",
      mainWorkout: "",
      athleteNote: "felt good",
      rpe: 8,
      duration: 60,
      status: COMPLETED,
    });
  });

  it("leaves exerciseDetails undefined when the entry has no exercise sets", () => {
    const recent = collectRecentWorkouts([makeEntry()]);
    expect(recent[0].exerciseDetails).toBeUndefined();
  });

  it("maps the relevant fields of each exercise set", () => {
    const recent = collectRecentWorkouts([
      makeEntry({
        exerciseSets: [
          makeSet({
            exerciseName: BACK_SQUAT,
            customLabel: "heavy",
            category: "strength",
            setNumber: 2,
            reps: 5,
            weight: 100,
            distance: 10,
            time: 20,
            notes: "deep",
            sortOrder: 3,
          }),
        ],
      }),
    ]);
    expect(recent[0].exerciseDetails).toEqual([
      {
        exerciseName: BACK_SQUAT,
        customLabel: "heavy",
        category: "strength",
        setNumber: 2,
        reps: 5,
        weight: 100,
        distance: 10,
        time: 20,
        notes: "deep",
        sortOrder: 3,
      },
    ]);
  });
});

describe("getStructuredExerciseStats", () => {
  it("returns undefined when no entries have exercise sets", () => {
    expect(getStructuredExerciseStats([makeEntry()])).toBeUndefined();
  });

  it("returns undefined for an empty timeline", () => {
    expect(getStructuredExerciseStats([])).toBeUndefined();
  });

  it("returns undefined when a completed entry has an empty exercise-set array", () => {
    expect(getStructuredExerciseStats([makeEntry({ exerciseSets: [] })])).toBeUndefined();
  });

  it("ignores exercise sets on non-completed entries", () => {
    expect(
      getStructuredExerciseStats([
        makeEntry({ status: PLANNED, exerciseSets: [makeSet({ reps: 5 })] }),
      ]),
    ).toBeUndefined();
  });

  it("aggregates count, max weight, max distance, best (min) time and average reps", () => {
    const stats = getStructuredExerciseStats([
      makeEntry({
        exerciseSets: [
          makeSet({ reps: 10, weight: 100, distance: 50, time: 40 }),
          makeSet({ reps: 20, weight: 120, distance: 200, time: 30 }),
        ],
      }),
    ]);
    expect(stats?.[BACK_SQUAT]).toEqual({
      count: 2,
      maxWeight: 120,
      maxDistance: 200,
      bestTime: 30,
      avgReps: 15,
    });
  });

  it("treats zero-valued weight/distance/time as absent (falsy guards)", () => {
    const stats = getStructuredExerciseStats([
      makeEntry({
        exerciseSets: [
          makeSet({ weight: 0, distance: 0, time: 0, reps: 10 }),
          makeSet({ weight: 80, distance: 100, time: 25, reps: 10 }),
        ],
      }),
    ]);
    expect(stats?.[BACK_SQUAT]).toEqual({
      count: 2,
      maxWeight: 80,
      maxDistance: 100,
      bestTime: 25,
      avgReps: 10,
    });
  });

  it("keeps the existing max/min when later sets do not beat them", () => {
    const stats = getStructuredExerciseStats([
      makeEntry({
        exerciseSets: [
          makeSet({ reps: 10, weight: 120, distance: 200, time: 30 }),
          makeSet({ reps: 10, weight: 100, distance: 50, time: 40 }),
        ],
      }),
    ]);
    expect(stats?.[BACK_SQUAT]).toEqual({
      count: 2,
      maxWeight: 120,
      maxDistance: 200,
      bestTime: 30,
      avgReps: 10,
    });
  });

  it("tracks distinct exercises independently", () => {
    const stats = getStructuredExerciseStats([
      makeEntry({
        exerciseSets: [
          makeSet({ exerciseName: BACK_SQUAT, reps: 5 }),
          makeSet({ exerciseName: "deadlift", reps: 3 }),
        ],
      }),
    ]);
    expect(stats?.[BACK_SQUAT]?.count).toBe(1);
    expect(stats?.deadlift?.count).toBe(1);
  });

  it("inflates count for measurement-less sets, which skews the running avgReps", () => {
    // count++ runs before the reps guard, so the null-rep set still bumps the
    // denominator: avg = round((10*2 + 20) / 3) = 13, not the true mean of 15.
    const stats = getStructuredExerciseStats([
      makeEntry({
        exerciseSets: [makeSet({ reps: 10 }), makeSet({ reps: null }), makeSet({ reps: 20 })],
      }),
    ]);
    expect(stats?.[BACK_SQUAT]?.count).toBe(3);
    expect(stats?.[BACK_SQUAT]?.avgReps).toBe(13);
  });
});

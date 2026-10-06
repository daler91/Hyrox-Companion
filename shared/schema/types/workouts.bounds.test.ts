import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addExerciseSetBodySchema,
  exercisesPayloadSchema,
  insertWorkoutLogSchema,
  MAX_WORKOUT_TEXT_LEN,
  updateWorkoutLogSchema,
  WORKOUT_METRIC_MAX,
} from "./workouts";

// W12: free-text workout fields must be length-bounded so a multi-MB blob can't
// pass Zod, land in the DB, and inflate AI token cost downstream. We assert on
// the presence/absence of a `too_big` issue for the field rather than overall
// schema success, so the test stays robust to other required-field changes.
const base = { date: "2020-01-01", focus: "Strength", mainWorkout: "Squats" };

function lengthIssue(value: Record<string, unknown>, field: string) {
  const result = insertWorkoutLogSchema.safeParse({ ...base, ...value });
  if (result.success) return undefined;
  return result.error.issues.find((i) => i.path.includes(field) && i.code === "too_big");
}

describe("workout log free-text bounds (W12)", () => {
  it("allows mainWorkout text exactly at the limit", () => {
    expect(lengthIssue({ mainWorkout: "a".repeat(MAX_WORKOUT_TEXT_LEN) }, "mainWorkout")).toBeUndefined();
  });

  it("rejects mainWorkout text over the limit", () => {
    expect(lengthIssue({ mainWorkout: "a".repeat(MAX_WORKOUT_TEXT_LEN + 1) }, "mainWorkout")).toBeDefined();
  });

  it("bounds the nullable notes field too", () => {
    expect(lengthIssue({ notes: "a".repeat(MAX_WORKOUT_TEXT_LEN + 1) }, "notes")).toBeDefined();
  });
});

// D56 (CODEBASE_ANALYSIS_2026-10-03): the metric columns are bounded so a
// seconds-for-minutes bug cannot store a 60-hour session.
describe("workout log metric bounds (D56)", () => {
  function metricIssue(value: Record<string, unknown>, field: string) {
    const result = insertWorkoutLogSchema.safeParse({ ...base, ...value });
    if (result.success) return undefined;
    return result.error.issues.find((issue) => issue.path.includes(field));
  }

  const atCap: Array<[field: string, max: number]> = [
    ["duration", WORKOUT_METRIC_MAX.durationMinutes],
    ["calories", WORKOUT_METRIC_MAX.calories],
    ["elevationGain", WORKOUT_METRIC_MAX.elevationGainMeters],
    ["avgSpeed", WORKOUT_METRIC_MAX.speedMetersPerSecond],
    ["maxSpeed", WORKOUT_METRIC_MAX.speedMetersPerSecond],
    ["avgWatts", WORKOUT_METRIC_MAX.avgWatts],
    ["sufferScore", WORKOUT_METRIC_MAX.sufferScore],
  ];

  it.each(atCap)("accepts %s at 0, at the cap, and null", (field, max) => {
    expect(metricIssue({ [field]: 0 }, field)).toBeUndefined();
    expect(metricIssue({ [field]: max }, field)).toBeUndefined();
    expect(metricIssue({ [field]: null }, field)).toBeUndefined();
  });

  it.each(atCap)("rejects %s above the cap or below 0", (field, max) => {
    expect(metricIssue({ [field]: max + 1 }, field)?.code).toBe("too_big");
    expect(metricIssue({ [field]: -1 }, field)?.code).toBe("too_small");
  });

  it("rejects a 60-hour session written as seconds into the minutes column", () => {
    expect(metricIssue({ duration: 60 * 60 }, "duration")).toBeDefined();
  });

  it("applies the same caps on update", () => {
    expect(updateWorkoutLogSchema.safeParse({ duration: 90 }).success).toBe(true);
    expect(
      updateWorkoutLogSchema.safeParse({ duration: WORKOUT_METRIC_MAX.durationMinutes + 1 })
        .success,
    ).toBe(false);
  });
});

// C50 (CODEBASE_ANALYSIS_2026-10-03): values their columns refuse must fail
// here, as a 400 naming the field, not in Postgres as a 500 that rolls back
// the whole save.
describe("workout request values the database would refuse (C50)", () => {
  function dateMessages(date: string): string[] {
    const result = insertWorkoutLogSchema.safeParse({ ...base, date });
    return (
      result.error?.issues
        .filter((issue) => issue.path[0] === "date")
        .map((issue) => issue.message) ?? []
    );
  }

  it.each(["2026-02-30", "2025-02-29", "2026-04-31"])(
    "names an impossible workout date %s once",
    (date) => {
      expect(dateMessages(date)).toEqual(["Must be a real calendar date"]);
    },
  );

  it("names a malformed workout date as a format error, not a future one", () => {
    expect(dateMessages("15/11/2026")).toEqual(["Must be a valid date in YYYY-MM-DD format"]);
  });

  it("still takes a real past date and refuses a future one", () => {
    expect(dateMessages("2024-02-29")).toEqual([]);
    expect(dateMessages("2999-01-01")).toEqual(["Workout date cannot be in the future"]);
  });

  function exerciseIssuePaths(exercise: Record<string, unknown>): string[] {
    const result = exercisesPayloadSchema.safeParse([{ exerciseName: "back_squat", ...exercise }]);
    return result.error?.issues.map((issue) => issue.path.join(".")) ?? [];
  }

  it.each([
    ["reps", { reps: 8.5 }, "0.reps"],
    ["plannedReps", { plannedReps: 8.5 }, "0.plannedReps"],
    ["a set's reps", { sets: [{ setNumber: 1, reps: 8.5 }] }, "0.sets.0.reps"],
    ["a set's plannedReps", { sets: [{ setNumber: 1, plannedReps: 8.5 }] }, "0.sets.0.plannedReps"],
    ["a set's setNumber", { sets: [{ setNumber: 1.5 }] }, "0.sets.0.setNumber"],
  ])("refuses a fractional %s", (_label, exercise, path) => {
    expect(exerciseIssuePaths(exercise)).toEqual([path]);
  });

  it("keeps whole counts and decimal weight, distance and time", () => {
    expect(
      exerciseIssuePaths({
        reps: 8,
        plannedReps: 10,
        weight: 62.5,
        distance: 402.3,
        time: 1.5,
        sets: [{ setNumber: 2, reps: 5, weight: 102.5, plannedWeight: 100.5, plannedTime: 0.75 }],
      }),
    ).toEqual([]);
  });

  it("refuses fractional reps on the per-set add route too", () => {
    const body = { exerciseName: "back_squat", category: "strength", setNumber: 1 };
    expect(addExerciseSetBodySchema.safeParse({ ...body, reps: 8 }).success).toBe(true);
    expect(addExerciseSetBodySchema.safeParse({ ...body, reps: 8.5 }).success).toBe(false);
  });
});

// CL70 (CODEBASE_ANALYSIS_2026-10-03): the bound was UTC's tomorrow, so a
// UTC+N athlete's tomorrow was refused until N o'clock. It is now tomorrow
// wherever that is latest (UTC+14); the use cases hold the athlete's own.
describe("workout date future bound (CL70)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function dateAccepted(date: string): boolean {
    return updateWorkoutLogSchema.safeParse({ date }).success;
  }

  it("takes tomorrow in the furthest-ahead timezone and refuses the day after", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 08:00 on 7 Oct in Kiritimati (UTC+14), so its tomorrow is the 8th.
    vi.setSystemTime(new Date("2026-10-06T18:00:00Z"));

    expect(dateAccepted("2026-10-08")).toBe(true);
    expect(dateAccepted("2026-10-09")).toBe(false);
  });

  it("takes a UTC+10 athlete's tomorrow first thing in their morning", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 08:00 on 7 Oct in Brisbane: tomorrow is the 8th, two UTC days ahead.
    vi.setSystemTime(new Date("2026-10-06T22:00:00Z"));

    expect(dateAccepted("2026-10-08")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import {
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

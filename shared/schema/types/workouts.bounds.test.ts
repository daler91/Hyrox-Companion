import { describe, expect, it } from "vitest";

import { insertWorkoutLogSchema, MAX_WORKOUT_TEXT_LEN } from "./workouts";

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

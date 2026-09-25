import { describe, expect, it } from "vitest";

import { classifyGoalLens, type ConstraintProfile, isExerciseAllowed } from "./exerciseProfile";

const NO_CONSTRAINTS: ConstraintProfile = {
  unavailable: new Set(),
  excluded: new Set(),
  regions: new Set(),
};

describe("classifyGoalLens", () => {
  // These fall back to the wizard's focus areas because the goal text is
  // empty; `classifyGoalLens`'s own goal-text patterns are covered via
  // exerciseSelection.test.ts.
  it("reads a running-only focus area as the running lens", () => {
    expect(classifyGoalLens(null, ["running"])).toBe("running");
  });

  it("reads a strength-only focus area as the strength lens", () => {
    expect(classifyGoalLens(null, ["strength"])).toBe("strength");
  });
});

describe("isExerciseAllowed", () => {
  it("excludes an exercise the athlete's own words ruled out, even with no other constraint", () => {
    const profile: ConstraintProfile = { ...NO_CONSTRAINTS, excluded: new Set(["burpees"]) };
    expect(isExerciseAllowed("burpees", profile, "advanced", true)).toBe(false);
  });

  it("allows an unconstrained exercise for an experienced athlete", () => {
    expect(isExerciseAllowed("back_squat", NO_CONSTRAINTS, "advanced", false)).toBe(true);
  });
});

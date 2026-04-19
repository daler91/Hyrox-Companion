import { describe, expect, it } from "vitest";

import type { WorkoutSuggestion } from "@shared/schema";

import {
  actionShift,
  influenceScore,
  jaccard,
  keywordPresence,
  priorityShift,
  rationaleDrift,
  targetOverlap,
  verdict,
} from "./metrics";

function s(overrides: Partial<WorkoutSuggestion> = {}): WorkoutSuggestion {
  return {
    workoutId: "day-1",
    workoutDate: "2026-04-20",
    workoutFocus: "strength",
    targetField: "mainWorkout",
    action: "replace",
    recommendation: "Squat 5x5 @ 80%",
    rationale: "Build phase, progressing steadily",
    priority: "medium",
    ...overrides,
  };
}

describe("metrics", () => {
  it("jaccard returns 1 for identical empty sets and 0 for disjoint", () => {
    expect(jaccard(new Set(), new Set())).toBe(1);
    expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
    expect(jaccard(new Set(["a", "b"]), new Set(["a"]))).toBeCloseTo(0.5);
  });

  it("targetOverlap is 0 when baseline and variant touch the same workouts", () => {
    const run = [[s()]];
    expect(targetOverlap(run, run)).toBe(0);
  });

  it("targetOverlap is 1 when baseline and variant are completely disjoint", () => {
    const a = [[s({ workoutId: "day-1" })]];
    const b = [[s({ workoutId: "day-7" })]];
    expect(targetOverlap(a, b)).toBe(1);
  });

  it("actionShift reflects replace/append ratio change", () => {
    const allReplace = [[s({ action: "replace" }), s({ action: "replace" })]];
    const allAppend = [[s({ action: "append" }), s({ action: "append" })]];
    expect(actionShift(allReplace, allAppend)).toBe(1);
    expect(actionShift(allReplace, allReplace)).toBe(0);
  });

  it("priorityShift is 0 for identical distributions and 1 for polar opposites", () => {
    const high = [[s({ priority: "high" })]];
    const low = [[s({ priority: "low" })]];
    expect(priorityShift(high, high)).toBe(0);
    expect(priorityShift(high, low)).toBe(1);
  });

  it("rationaleDrift detects semantic divergence in rationales", () => {
    const a = [[s({
      rationale: "progressing build phase",
      recommendation: "increase weight",
    })]];
    const b = [[s({
      rationale: "fatigue deload recovery",
      recommendation: "reduce volume",
    })]];
    expect(rationaleDrift(a, b)).toBeGreaterThan(0.9);
    expect(rationaleDrift(a, a)).toBeLessThan(0.001);
  });

  it("keywordPresence matches expected signal words case-insensitively", () => {
    const bundle = [[s({
      rationale: "Clear signs of FATIGUE, recommend deload",
      recommendation: "reduce load",
    })]];
    const { matched, ratio } = keywordPresence(bundle, ["fatigue", "deload", "plateau"]);
    expect(matched).toEqual(["fatigue", "deload"]);
    expect(ratio).toBeCloseTo(2 / 3);
  });

  it("influenceScore is bounded in [0, 1] and monotonic in key signals", () => {
    const low = influenceScore({
      suggestionCountDelta: 0,
      targetOverlap: 0,
      actionShift: 0,
      priorityShift: 0,
      rationaleDrift: 0,
      keywordRatio: 0,
      keywordMatched: [],
    });
    const high = influenceScore({
      suggestionCountDelta: 5,
      targetOverlap: 1,
      actionShift: 1,
      priorityShift: 1,
      rationaleDrift: 1,
      keywordRatio: 1,
      keywordMatched: ["x"],
    });
    expect(low).toBe(0);
    expect(high).toBe(1);
    expect(low).toBeLessThan(high);
  });

  it("verdict labels IGNORED at noise floor and STRONG well above it", () => {
    expect(verdict(0.05, 0.05)).toBe("IGNORED");
    expect(verdict(0.08, 0.05)).toBe("IGNORED");
    expect(verdict(0.20, 0.05)).toBe("WEAK");
    expect(verdict(0.45, 0.05)).toBe("MODERATE");
    expect(verdict(0.75, 0.05)).toBe("STRONG");
  });
});

import { describe, expect, it } from "vitest";

import { bucketsFromStretches, thresholdSession } from "./testFixtures";
import { findWorkSegments, otsuCut } from "./workSegments";

describe("otsuCut", () => {
  it("needs at least two values", () => {
    expect(otsuCut([])).toBeNull();
    expect(otsuCut([3])).toBeNull();
  });

  it("returns null when every value is identical, so there is nothing to split", () => {
    expect(otsuCut([4, 4, 4, 4])).toBeNull();
  });

  it("cuts between two clear groups, returning the lowest value of the upper group", () => {
    expect(otsuCut([1, 1, 1, 9, 9, 9])).toBe(9);
    expect(otsuCut([9, 1, 9, 1, 1, 9])).toBe(9);
  });
});

describe("findWorkSegments", () => {
  it("finds the three reps of a threshold session, bridging nothing between them", () => {
    const samples = bucketsFromStretches(thresholdSession({ pace: 300, hrStart: 160, hrEnd: 165 }));
    const result = findWorkSegments(samples, { speedTrusted: true });
    expect(result.kind).toBe("reps");
    expect(result.signal).toBe("speed");
    expect(result.segments).toHaveLength(3);
    for (const segment of result.segments) expect(segment.length).toBeGreaterThanOrEqual(36);
  });

  it("falls back to heart rate when the speed is not trusted", () => {
    const samples = bucketsFromStretches(thresholdSession({ pace: 300, hrStart: 165, hrEnd: 170 }));
    const result = findWorkSegments(samples, { speedTrusted: false });
    expect(result.signal).toBe("hr");
    expect(result.kind).toBe("reps");
  });

  it("grades a long steady run as one continuous block minus warm-up and cool-down", () => {
    const samples = bucketsFromStretches([{ seconds: 40 * 60, paceSecPerKm: 330, hr: 150, hrEnd: 150 }]);
    const result = findWorkSegments(samples, { speedTrusted: true });
    expect(result.kind).toBe("continuous");
    expect(result.segments).toHaveLength(1);
    // 40 min moving, minus 10 min warm-up and 5 min cool-down, in 15 s buckets.
    expect(result.segments[0]).toHaveLength((25 * 60) / 15);
    expect(result.segments[0]?.[0]).toBe((10 * 60) / 15);
  });

  it("finds no work in a run too short for a continuous block", () => {
    const samples = bucketsFromStretches([{ seconds: 10 * 60, paceSecPerKm: 330, hr: 150, hrEnd: 150 }]);
    expect(findWorkSegments(samples, { speedTrusted: true })).toEqual({
      kind: "none",
      signal: "speed",
      segments: [],
    });
  });

  it("has no signal at all without moving time", () => {
    const samples = bucketsFromStretches([{ seconds: 30 * 60 }]);
    expect(findWorkSegments(samples, { speedTrusted: true })).toEqual({ kind: "none", signal: null, segments: [] });
  });
});

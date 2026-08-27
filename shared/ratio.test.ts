import { describe, expect, it } from "vitest";

import { pooledPercentage, pooledRatio, roundOrNull, weightedMean } from "./ratio";

describe("pooledRatio", () => {
  it("divides the total numerator by the total denominator", () => {
    expect(pooledRatio(9, 3)).toBe(3);
  });

  it("returns null, not 0, for a zero denominator", () => {
    // The H6 case: an athlete with no plan has 0 due sessions, not a 0%
    // completion rate. Collapsing "no basis to answer" into "the answer is
    // zero" is what emailed a 100% completion rate to an athlete with nothing
    // scheduled (0/0 read as complete elsewhere before this helper existed).
    expect(pooledRatio(5, 0)).toBeNull();
    expect(pooledRatio(0, 0)).toBeNull();
  });

  it("returns null for a non-finite numerator or denominator", () => {
    expect(pooledRatio(Number.NaN, 3)).toBeNull();
    expect(pooledRatio(3, Number.POSITIVE_INFINITY)).toBeNull();
    expect(pooledRatio(Number.NEGATIVE_INFINITY, 3)).toBeNull();
  });

  it("allows a negative ratio (e.g. a net-negative delta)", () => {
    expect(pooledRatio(-4, 2)).toBe(-2);
  });
});

describe("pooledPercentage", () => {
  it("scales the pooled ratio to a percentage", () => {
    expect(pooledPercentage(1, 4)).toBe(25);
  });

  it("propagates null from a zero denominator", () => {
    expect(pooledPercentage(5, 0)).toBeNull();
  });
});

describe("weightedMean", () => {
  it("weights larger groups more heavily than an unweighted average would", () => {
    // The H9 case: one RPE-10 session in a quiet week (weight 1) against six
    // RPE-4 sessions in a heavy week (weight 6). Averaging the two weekly
    // means unweighted gives 7.0; weighting by session count gives the true
    // pooled average of all seven sessions, 4.857.
    const result = weightedMean([10, 4], [1, 6]);
    expect(result).toBeCloseTo(4.857142857, 6);
  });

  it("returns null when values and weights have different lengths", () => {
    expect(weightedMean([1, 2, 3], [1, 1])).toBeNull();
  });

  it("returns null for an empty input (no basis to answer)", () => {
    expect(weightedMean([], [])).toBeNull();
  });

  it("skips a null or undefined value/weight rather than treating it as zero", () => {
    // A null value paired with its weight would silently drag the mean toward
    // zero; skipping the pair is the same "not measured" contract as the rest
    // of the module.
    const result = weightedMean([10, null as unknown as number, 20], [1, 1, 1]);
    expect(result).toBe(15);
  });

  it("skips a non-positive weight rather than letting it invert or zero the result", () => {
    expect(weightedMean([10, 20], [1, 0])).toBe(10);
    expect(weightedMean([10, 20], [1, -5])).toBe(10);
  });

  it("skips a non-finite value or weight", () => {
    expect(weightedMean([10, Number.NaN], [1, 1])).toBe(10);
    expect(weightedMean([10, 20], [1, Number.POSITIVE_INFINITY])).toBe(10);
  });

  it("returns null when every pair is filtered out", () => {
    expect(weightedMean([Number.NaN, Number.NaN], [1, 1])).toBeNull();
    expect(weightedMean([10, 20], [0, 0])).toBeNull();
  });
});

describe("roundOrNull", () => {
  it("rounds to the given number of decimal places", () => {
    expect(roundOrNull(4.857142857, 1)).toBe(4.9);
    expect(roundOrNull(4.857142857, 2)).toBe(4.86);
  });

  it("defaults to one decimal place", () => {
    expect(roundOrNull(4.857142857)).toBe(4.9);
  });

  it("preserves null rather than throwing", () => {
    expect(roundOrNull(null)).toBeNull();
  });

  it("returns null for a non-finite value", () => {
    expect(roundOrNull(Number.NaN)).toBeNull();
    expect(roundOrNull(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

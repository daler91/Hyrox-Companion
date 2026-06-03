import { describe, expect, it } from "vitest";

import { RACE_RANKINGS } from "./raceRankingData.generated";
import { computeRanking } from "./ranking";

describe("computeRanking", () => {
  const cdf = RACE_RANKINGS["open|male"];

  it("ranks the cohort median at roughly the 50th percentile", () => {
    const median = cdf.finishSecondsByPercentile[49]; // p50
    const r = computeRanking("open", "male", null, median);
    expect(r).not.toBeNull();
    expect(r!.fasterThanPct).toBeGreaterThanOrEqual(48);
    expect(r!.fasterThanPct).toBeLessThanOrEqual(52);
    expect(r!.basis).toBe("division_gender");
    expect(r!.cohortSize).toBe(cdf.sampleSize);
  });

  it("clamps the rank at the distribution ends", () => {
    expect(computeRanking("open", "male", null, 1)!.fasterThanPct).toBe(99); // impossibly fast
    expect(computeRanking("open", "male", null, 99_999)!.fasterThanPct).toBe(1); // impossibly slow
  });

  it("is monotonic — a faster predicted finish beats a larger share", () => {
    const median = cdf.finishSecondsByPercentile[49];
    const faster = computeRanking("open", "male", null, median - 600)!.fasterThanPct;
    const slower = computeRanking("open", "male", null, median + 600)!.fasterThanPct;
    expect(faster).toBeGreaterThan(slower);
  });

  it("uses an age-specific cohort when present, else falls back to division×gender", () => {
    const median = cdf.finishSecondsByPercentile[49];
    expect(computeRanking("open", "male", "30-34", median)!.basis).toBe("age_group");
    // 80-84 is below the sample gate for open men, so it isn't emitted → fallback.
    expect(computeRanking("open", "male", "80-84", median)!.basis).toBe("division_gender");
  });
});

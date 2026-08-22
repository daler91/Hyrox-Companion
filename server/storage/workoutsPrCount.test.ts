import { describe, expect, it } from "vitest";

import { countPrSets } from "./workouts";

const sets = (...pairs: [string, number | null][]) =>
  pairs.map(([exerciseName, weight]) => ({ exerciseName, weight }));

describe("countPrSets — a set must not be measured against a max it is inside (audit M12)", () => {
  it("counts a genuine new best", () => {
    // Previous best 110; this workout hit 120.
    expect(countPrSets(sets(["back_squat", 120]), new Map([["back_squat", 110]]))).toBe(1);
  });

  it("does NOT count merely equalling the previous best", () => {
    // The old form compared >= against a max that included this very set, so
    // repeating last week's 120 was reported as a fresh PR.
    expect(countPrSets(sets(["back_squat", 120]), new Map([["back_squat", 120]]))).toBe(0);
  });

  it("does not count a lighter session", () => {
    expect(countPrSets(sets(["back_squat", 110]), new Map([["back_squat", 120]]))).toBe(0);
  });

  it("counts each exercise at most once", () => {
    expect(
      countPrSets(sets(["back_squat", 120], ["back_squat", 125]), new Map([["back_squat", 110]])),
    ).toBe(1);
  });

  it("treats a first-ever weighted attempt as a baseline, not a record", () => {
    expect(countPrSets(sets(["snatch", 60]), new Map())).toBe(0);
  });

  it("ignores unweighted sets", () => {
    expect(countPrSets(sets(["run", null]), new Map([["run", 0]]))).toBe(0);
  });
});

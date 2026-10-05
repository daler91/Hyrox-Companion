import { describe, expect, it } from "vitest";

import { bestPriorWeightsKg, countPrSets, setsInKg } from "./workoutsPrCount";

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

describe("PR baselines read each weight through its own unit stamp (C45)", () => {
  // CODEBASE_ANALYSIS_2026-10-03: raw weights were compared across kg and lbs
  // stamps, so 200 lbs (~91 kg) read as a record over a 100 kg best.
  const lbsAthlete = { weightUnit: "lbs" };

  it("compares a kg best and a lbs best in one unit", () => {
    const best = bestPriorWeightsKg(
      [
        { exerciseName: "back_squat", weightUnit: "lbs", maxWeight: 200 },
        { exerciseName: "back_squat", weightUnit: "kg", maxWeight: 95 },
      ],
      lbsAthlete,
    );
    expect(best.get("back_squat")).toBe(95);
  });

  it("reads a legacy, unstamped best in the athlete's current unit", () => {
    const best = bestPriorWeightsKg(
      [{ exerciseName: "back_squat", weightUnit: null, maxWeight: 220.462 }],
      lbsAthlete,
    );
    expect(best.get("back_squat")).toBeCloseTo(100, 3);
  });

  it("counts a lbs set as a record only when it beats the kg best in kg", () => {
    // 225 lbs is ~102 kg, so it beats a 100 kg best; 200 lbs (~91 kg) does
    // not, though the raw 200 > 100 used to say it did.
    const thisWorkout = setsInKg(
      [{ exerciseName: "back_squat", weight: 225, weightUnit: "lbs" }],
      lbsAthlete,
    );
    const best = bestPriorWeightsKg(
      [{ exerciseName: "back_squat", weightUnit: "kg", maxWeight: 100 }],
      lbsAthlete,
    );
    expect(countPrSets(thisWorkout, best)).toBe(1);

    const lighter = setsInKg(
      [{ exerciseName: "back_squat", weight: 200, weightUnit: "lbs" }],
      lbsAthlete,
    );
    expect(countPrSets(lighter, best)).toBe(0);
  });

  it("keeps unweighted sets unweighted", () => {
    expect(setsInKg([{ exerciseName: "run", weight: null, weightUnit: "kg" }], lbsAthlete)).toEqual(
      [{ exerciseName: "run", weight: null }],
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  describeUnitPlausibility,
  detectDistanceUnitSwitch,
  detectWeightUnitSwitch,
  type LoggedMeasurement,
} from "./unitSwitchDetection";

function rows(
  entries: readonly (readonly [date: string, exercise: string, value: number])[],
): LoggedMeasurement[] {
  return entries.map(([date, exercise, value]) => ({ date, exercise, value }));
}

/**
 * A real kg history and the same lifts after a switch to lbs, with each side
 * rounded the way its own unit stores. Computed rather than invented: 100 kg is
 * 220 lb, 102.5 is 226, 105 is 231; 60 is 132, 62.5 is 138, 65 is 143.
 */
const SWITCHED_TO_LBS = rows([
  ["2026-01-05", "back_squat", 100],
  ["2026-01-12", "back_squat", 102.5],
  ["2026-01-19", "back_squat", 105],
  ["2026-01-05", "overhead_press", 60],
  ["2026-01-12", "overhead_press", 62.5],
  ["2026-01-19", "overhead_press", 65],
  // --- the athlete toggles their display preference here ---
  ["2026-02-02", "back_squat", 220],
  ["2026-02-09", "back_squat", 226],
  ["2026-02-16", "back_squat", 231],
  ["2026-02-02", "overhead_press", 132],
  ["2026-02-09", "overhead_press", 138],
  ["2026-02-16", "overhead_press", 143],
]);

describe("detectWeightUnitSwitch", () => {
  it("finds the day the athlete's whole history changed scale", () => {
    const found = detectWeightUnitSwitch(SWITCHED_TO_LBS);

    expect(found).not.toBeNull();
    expect(found!.onDate).toBe("2026-02-02");
    expect(found!.direction).toBe("up");
    // Both lifts agree, which is what separates this from getting stronger.
    expect(found!.evidence).toHaveLength(2);
    for (const e of found!.evidence) expect(e.ratio).toBeCloseTo(2.2, 1);
  });

  it("finds a switch in the other direction too", () => {
    const backToKg = rows(
      SWITCHED_TO_LBS.map((r) => [
        // Mirror the history: lbs first, then kg.
        r.date < "2026-02-01" ? `2026-03-${r.date.slice(-2)}` : `2026-01-${r.date.slice(-2)}`,
        r.exercise,
        r.value,
      ]),
    );

    const found = detectWeightUnitSwitch(backToKg);

    expect(found).not.toBeNull();
    expect(found!.direction).toBe("down");
  });

  it("does NOT fire on an athlete who simply got stronger", () => {
    // Steady progression on both lifts, no scale change anywhere.
    const progressing = rows([
      ["2026-01-05", "back_squat", 100],
      ["2026-02-05", "back_squat", 110],
      ["2026-03-05", "back_squat", 120],
      ["2026-01-05", "overhead_press", 60],
      ["2026-02-05", "overhead_press", 63],
      ["2026-03-05", "overhead_press", 66],
    ]);

    expect(detectWeightUnitSwitch(progressing)).toBeNull();
  });

  it("does NOT fire when ONE lift doubles and the others do not", () => {
    // The case that would make a naive whole-history ratio test wrong: a real,
    // dramatic change on a single exercise. A unit switch cannot be selective.
    const oneLiftJumped = rows([
      ["2026-01-05", "back_squat", 100],
      ["2026-01-12", "back_squat", 100],
      ["2026-02-02", "back_squat", 220],
      ["2026-02-09", "back_squat", 220],
      ["2026-01-05", "overhead_press", 60],
      ["2026-01-12", "overhead_press", 60],
      ["2026-02-02", "overhead_press", 62],
      ["2026-02-09", "overhead_press", 62],
    ]);

    expect(detectWeightUnitSwitch(oneLiftJumped)).toBeNull();
  });

  it("needs more than one exercise before it will call a switch", () => {
    // A single lift jumping by 2.2x is a plausible data-entry error or a real
    // change of implement. It is not enough to re-scale someone's history on.
    const onlyOneExercise = rows([
      ["2026-01-05", "back_squat", 100],
      ["2026-01-12", "back_squat", 100],
      ["2026-02-02", "back_squat", 220],
      ["2026-02-09", "back_squat", 220],
    ]);

    expect(detectWeightUnitSwitch(onlyOneExercise)).toBeNull();
  });

  it("reports the date the scale actually changed, not an earlier one that happens to fit", () => {
    // The bug this test was written for. At 2026-01-12 the "after" side still
    // holds the pre-switch days, so its median is dragged up to 220 and the
    // ratio against a lone 100 lands on exactly 2.2 — agreeing for the wrong
    // reason. A human splitting the history there would convert three days that
    // were already in the new unit.
    const found = detectWeightUnitSwitch(SWITCHED_TO_LBS);

    expect(found!.onDate).not.toBe("2026-01-12");
    expect(found!.onDate).toBe("2026-02-02");
    // Both sides are internally one scale, which is what makes it the boundary.
    for (const e of found!.evidence) {
      expect(e.medianBefore).toBeLessThan(120);
      expect(e.medianAfter).toBeGreaterThan(120);
    }
  });

  it("survives warm-up sets that make one day's range look like a scale change", () => {
    // 60 warm-up through 140 top set is a 2.33x spread inside a single day —
    // wider than the conversion factor. Comparing raw sets would read that as a
    // switch; a daily median reads it as a normal session.
    const withWarmups = rows([
      ["2026-01-05", "back_squat", 60],
      ["2026-01-05", "back_squat", 100],
      ["2026-01-05", "back_squat", 140],
      ["2026-01-12", "back_squat", 60],
      ["2026-01-12", "back_squat", 100],
      ["2026-01-12", "back_squat", 140],
      ["2026-01-05", "deadlift", 80],
      ["2026-01-05", "deadlift", 120],
      ["2026-01-05", "deadlift", 160],
      ["2026-01-12", "deadlift", 80],
      ["2026-01-12", "deadlift", 120],
      ["2026-01-12", "deadlift", 160],
    ]);

    expect(detectWeightUnitSwitch(withWarmups)).toBeNull();
  });

  it("returns null for an athlete with no history at all", () => {
    expect(detectWeightUnitSwitch([])).toBeNull();
  });

  it("ignores exercises that appear on only one side of the boundary", () => {
    // Starting a new lift after the switch says nothing about the switch, so it
    // must not dilute or fabricate agreement.
    const withANewLift = rows([
      ...SWITCHED_TO_LBS.map((r) => [r.date, r.exercise, r.value] as const),
      ["2026-02-16", "deadlift", 315],
    ]);

    const found = detectWeightUnitSwitch(withANewLift);

    expect(found).not.toBeNull();
    expect(found!.evidence.map((e) => e.exercise)).not.toContain("deadlift");
  });
});

describe("detectDistanceUnitSwitch", () => {
  it("finds a metres-to-feet switch, which is a 3.28x jump not a 2.2x one", () => {
    // A miles athlete stores FEET, so switching km -> miles multiplies logged
    // distances by 3.28084: 400 m becomes 1312 ft, 1000 m becomes 3281 ft.
    const switched = rows([
      ["2026-01-05", "run", 400],
      ["2026-01-12", "run", 400],
      ["2026-01-05", "row", 1000],
      ["2026-01-12", "row", 1000],
      ["2026-02-02", "run", 1312],
      ["2026-02-09", "run", 1312],
      ["2026-02-02", "row", 3281],
      ["2026-02-09", "row", 3281],
    ]);

    const found = detectDistanceUnitSwitch(switched);

    expect(found).not.toBeNull();
    expect(found!.onDate).toBe("2026-02-02");
    expect(found!.direction).toBe("up");
  });

  it("does not mistake a distance switch for a weight one", () => {
    // 3.28x is nowhere near 2.2x, so the weight detector must stay silent.
    const distanceSwitch = rows([
      ["2026-01-05", "run", 400],
      ["2026-01-12", "run", 400],
      ["2026-01-05", "row", 1000],
      ["2026-01-12", "row", 1000],
      ["2026-02-02", "run", 1312],
      ["2026-02-09", "run", 1312],
      ["2026-02-02", "row", 3281],
      ["2026-02-09", "row", 3281],
    ]);

    expect(detectWeightUnitSwitch(distanceSwitch)).toBeNull();
  });
});

describe("describeUnitPlausibility — the weak second signal", () => {
  it("flags an lbs athlete whose logged weights look like kilos", () => {
    // The case the boundary test structurally cannot see: switched, then logged
    // nothing, so the whole history sits in the old unit with no discontinuity.
    expect(describeUnitPlausibility([40, 45, 50, 55, 60, 42.5], "lbs")).toBe("suspect");
  });

  it("flags a kg athlete whose logged weights look like pounds", () => {
    expect(describeUnitPlausibility([225, 245, 275, 315, 185, 205], "kg")).toBe("suspect");
  });

  it("says nothing in the band where both units are plausible", () => {
    // 100 could be a strong kg lift or a modest lbs one. Guessing here would be
    // worse than declining to.
    expect(describeUnitPlausibility([95, 100, 105, 110, 100, 100], "kg")).toBe("unknown");
    expect(describeUnitPlausibility([95, 100, 105, 110, 100, 100], "lbs")).toBe("unknown");
  });

  it("declines to judge an athlete with barely any data", () => {
    // "consistent" here would turn an absence of evidence into evidence of
    // absence, which is exactly the mistake this whole exercise is avoiding.
    expect(describeUnitPlausibility([40, 45], "lbs")).toBe("unknown");
    expect(describeUnitPlausibility([], "kg")).toBe("unknown");
  });

  it("confirms an athlete whose weights match their stated unit", () => {
    expect(describeUnitPlausibility([225, 245, 275, 315, 185, 205], "lbs")).toBe("consistent");
    expect(describeUnitPlausibility([40, 45, 50, 55, 60, 42.5], "kg")).toBe("consistent");
  });
});

import { describe, expect, it } from "vitest";

import { buildRunPaceZones } from "../workoutEngine/running";
import { hasTargets, resolveGradeTargets, type TargetInputs } from "./targets";
import { ATHLETE } from "./testFixtures";

function inputs(overrides: Partial<TargetInputs> = {}): TargetInputs {
  return {
    intent: "threshold",
    athlete: ATHLETE,
    mafCeilingHr: null,
    planText: "",
    engineVdot: null,
    historyZones: null,
    ...overrides,
  };
}

describe("resolveGradeTargets", () => {
  it("takes the HR bands from the app's Karvonen zones", () => {
    const targets = resolveGradeTargets(inputs());
    expect(targets).toMatchObject({
      easyCeilingHr: 148,
      thresholdHr: { min: 162, max: 176 },
      z5FloorHr: 176,
      hrBasis: "measured",
    });
  });

  it("marks zones built on an age estimate, and has none without max HR or age", () => {
    expect(resolveGradeTargets(inputs({ athlete: { age: 40 } })).hrBasis).toBe("age_estimated");
    const none = resolveGradeTargets(inputs({ athlete: {} }));
    expect(none).toMatchObject({ easyCeilingHr: null, thresholdHr: null, z5FloorHr: null, hrBasis: null });
  });

  it("grades easy runs against the MAF ceiling for a MAF athlete", () => {
    const targets = resolveGradeTargets(inputs({ intent: "easy", mafCeilingHr: 139 }));
    expect(targets).toMatchObject({ easyCeilingHr: 139, hrBasis: "maf" });
    // Threshold keeps the zone model.
    expect(resolveGradeTargets(inputs({ mafCeilingHr: 139 })).hrBasis).toBe("measured");
  });

  it("prefers a pace written in the plan day: the fastest for threshold, the slowest range for easy", () => {
    const text = "15 min easy @ 6:05-6:42/km, 3 x 10 min @ 4:52/km with 2 min jog, 10 min easy";
    expect(resolveGradeTargets(inputs({ planText: text, engineVdot: 50 }))).toMatchObject({
      thresholdPace: 292,
      paceSource: "plan",
    });
    const longRun = "16 km easy @ 6:05-6:42/km, last 15 min @ 5:10/km";
    expect(resolveGradeTargets(inputs({ intent: "easy", planText: longRun }))).toMatchObject({
      easyPace: { fast: 365, slow: 402 },
      paceSource: "plan",
    });
  });

  it("reads per-mile paces in seconds per km", () => {
    const targets = resolveGradeTargets(inputs({ planText: "3 x 10 min @ 7:50/mi" }));
    expect(targets.thresholdPace).toBeCloseTo(470 / 1.609344, 0);
  });

  it("ignores paces no run is written at", () => {
    const targets = resolveGradeTargets(inputs({ planText: "walk @ 12:00/km" }));
    expect(targets.paceSource).toBeNull();
  });

  it("falls back to the plan's engine fitness, then to paces fitted from recent runs", () => {
    const engine = resolveGradeTargets(inputs({ engineVdot: 45 }));
    expect(engine.paceSource).toBe("engine");
    expect(engine.thresholdPace).toBeGreaterThan(260);
    expect(engine.thresholdPace).toBeLessThan(290);

    const zones = buildRunPaceZones([
      { date: "2026-09-01", meters: 5000, seconds: 1500 },
      { date: "2026-09-08", meters: 10000, seconds: 3100 },
    ]);
    const history = resolveGradeTargets(inputs({ intent: "easy", historyZones: zones }));
    expect(history.paceSource).toBe("history");
    expect(history.easyPace).toEqual(zones?.easy);
  });
});

describe("hasTargets", () => {
  it("needs an HR band or a pace for the intent being graded", () => {
    const none = resolveGradeTargets(inputs({ athlete: {} }));
    expect(hasTargets("threshold", none)).toBe(false);
    expect(hasTargets("threshold", { ...none, thresholdPace: 290 })).toBe(true);
    expect(hasTargets("easy", { ...none, thresholdPace: 290 })).toBe(false);
  });
});

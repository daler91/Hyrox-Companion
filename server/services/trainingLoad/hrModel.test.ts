import { describe, expect, it } from "vitest";

import { calculateTrainingLoad } from "../trainingLoadService";
import { makeWorkoutLog } from "../trainingLoadService.testHelpers";
import { estimateLthr, hrTss } from "./hrModel";

/**
 * C10 (CODEBASE_ANALYSIS_2026-10-03): the audit H3 fix withheld heart-rate
 * reserve and zones when HRmax is only the assumed 190 (no measured max, no
 * age), but LTHR and hrTSS kept scoring against it.
 */
describe("LTHR and hrTSS without a measured max HR or an age (C10)", () => {
  it("withholds hrTSS rather than anchor it on 88% of an assumed 190", () => {
    // 151 bpm is a 52-year-old's threshold (Tanaka 172 x 0.88). Against the
    // assumed LTHR of 167 it scored 78.8 instead of 100.
    expect(hrTss(60, 151, {})).toBeNull();
    expect(hrTss(60, 151, { restingHr: 60 })).toBeNull();
    expect(hrTss(60, 151)).toBeNull();
  });

  it("estimates no LTHR from a resting HR alone", () => {
    expect(estimateLthr({})).toBeNull();
    expect(estimateLthr({ restingHr: 60 })).toBeNull();
  });

  it("scores the same hour at threshold once the age is known", () => {
    expect(estimateLthr({ age: 52 })).toBe(151);
    expect(hrTss(60, 151, { age: 52 })).toBeCloseTo(100, 0);
  });

  it("gives the overview no LTHR, no hrTSS and no zones to show", () => {
    const currentDate = "2026-05-22";
    const logs = [
      makeWorkoutLog({ id: "hr", date: currentDate, duration: 60, avgHeartrate: 151, rpe: 8 }),
    ];

    const unknown = calculateTrainingLoad(logs, [], [], {
      currentDate,
      athlete: { restingHr: 60 },
    });
    expect(unknown.overview.estimatedLthr).toBeNull();
    expect(unknown.overview.hrTss).toBeNull();
    expect(unknown.overview.hrZones).toEqual([]);
    expect(unknown.dailyLoads.find((d) => d.date === currentDate)?.hrTss).toBeNull();

    const aged = calculateTrainingLoad(logs, [], [], {
      currentDate,
      athlete: { restingHr: 60, age: 52 },
    });
    expect(aged.overview.estimatedLthr).toBe(151);
    expect(aged.overview.hrTss).toBeCloseTo(100, 0);
  });
});

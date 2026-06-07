import { describe, expect, it } from "vitest";

import { calculateMafHr, computeMafCompliance, metersPerSecond } from "./maf";

describe("calculateMafHr", () => {
  it("applies conservative -10 first when injury flag is present", () => {
    const result = calculateMafHr({ age: 35, injuryIllnessMedication: true, consistency: "high", trend: "improving" });
    expect(result.adjustment).toBe(-10);
    expect(result.ceiling).toBe(135);
    expect(result.reasonCodes).toContain("injury_illness_medication");
  });

  it("applies +5 only when athlete is high consistency and improving", () => {
    const result = calculateMafHr({ age: 40, injuryIllnessMedication: false, consistency: "high", trend: "improving" });
    expect(result.adjustment).toBe(5);
    expect(result.ceiling).toBe(145);
  });

  it("returns under-16 warning with conservative default", () => {
    const result = calculateMafHr({ age: 15, injuryIllnessMedication: false, consistency: "high", trend: "improving" });
    expect(result.adjustment).toBe(-10);
    expect(result.warning).toMatch(/Under-16/);
  });

  it("applies the conservative -5 at exactly age 65, not +5 (S1 boundary)", () => {
    const result = calculateMafHr({ age: 65, injuryIllnessMedication: false, consistency: "high", trend: "improving" });
    expect(result.adjustment).toBe(-5);
    expect(result.ceiling).toBe(110); // base 180-65=115, -5 = 110
    expect(result.reasonCodes).toContain("age_over_65_conservative_default");
  });

  it("applies -5 for low consistency or declining trend", () => {
    const result = calculateMafHr({ age: 30, injuryIllnessMedication: false, consistency: "low", trend: "improving" });
    expect(result.adjustment).toBe(-5);
    expect(result.reasonCodes).toContain("low_consistency_or_declining_trend");
  });

  it("applies 0 adjustment for moderate consistency or flat trend", () => {
    const result = calculateMafHr({ age: 30, injuryIllnessMedication: false, consistency: "moderate", trend: "improving" });
    expect(result.adjustment).toBe(0);
    expect(result.reasonCodes).toContain("moderate_consistency_or_flat_trend");
  });
});

describe("computeMafCompliance", () => {
  it("is 100% compliant when avg and peak stay at/under the ceiling", () => {
    const r = computeMafCompliance({ avgHeartRate: 138, maxHeartRate: 142, ceiling: 145 });
    expect(r.classification).toBe("compliant");
    expect(r.compliancePct).toBe(100);
  });

  it("downgrades to mostly_compliant when the peak drifts well over the ceiling", () => {
    const r = computeMafCompliance({ avgHeartRate: 140, maxHeartRate: 158, ceiling: 145 });
    expect(r.classification).toBe("mostly_compliant");
    expect(r.compliancePct).toBe(85);
  });

  it("scales compliance down ~6 pts per bpm the average runs over", () => {
    const r = computeMafCompliance({ avgHeartRate: 150, maxHeartRate: 165, ceiling: 145 });
    expect(r.classification).toBe("over_ceiling");
    expect(r.compliancePct).toBe(70); // 5 bpm over * 6 = 30 off
    expect(r.details.avgOverBy).toBe(5);
  });

  it("floors compliance at 0 for a very over-ceiling effort", () => {
    const r = computeMafCompliance({ avgHeartRate: 200, maxHeartRate: 210, ceiling: 145 });
    expect(r.compliancePct).toBe(0);
  });

  it("treats a sub-ceiling average with unknown peak as compliant", () => {
    const r = computeMafCompliance({ avgHeartRate: 140, maxHeartRate: null, ceiling: 145 });
    expect(r.classification).toBe("compliant");
    expect(r.details.maxOverBy).toBeNull();
  });
});

describe("metersPerSecond", () => {
  it("calculates meters per second correctly", () => {
    expect(metersPerSecond(1000, 200)).toBe(5);
    expect(metersPerSecond(5000, 1000)).toBe(5);
    expect(metersPerSecond(42195, 14400)).toBeCloseTo(2.93, 2);
  });

  it("returns null if distanceMeters is missing, zero, or negative", () => {
    expect(metersPerSecond(null, 200)).toBeNull();
    expect(metersPerSecond(0, 200)).toBeNull();
    expect(metersPerSecond(-100, 200)).toBeNull();
  });

  it("returns null if durationSeconds is missing, zero, or negative", () => {
    expect(metersPerSecond(1000, null)).toBeNull();
    expect(metersPerSecond(1000, 0)).toBeNull();
    expect(metersPerSecond(1000, -200)).toBeNull();
  });

  it("returns null if both are missing, zero, or negative", () => {
    expect(metersPerSecond(null, null)).toBeNull();
    expect(metersPerSecond(0, 0)).toBeNull();
    expect(metersPerSecond(-100, -200)).toBeNull();
  });
});

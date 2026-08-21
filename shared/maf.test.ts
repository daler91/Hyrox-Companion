import { describe, expect, it } from "vitest";

import { calculateMafHr, computeMafCompliance } from "./maf";

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

  it("keeps the earned category at age 65 and adds a clinician check, not a penalty", () => {
    const result = calculateMafHr({ age: 65, injuryIllnessMedication: false, consistency: "high", trend: "improving" });
    // base 180-65=115, category (d) +5 = 120. This branch used to force -5 and
    // return 110, costing a healthy athlete 11 bpm on their birthday (audit C2).
    expect(result.adjustment).toBe(5);
    expect(result.ceiling).toBe(120);
    expect(result.reasonCodes).toContain("high_consistency_and_improving_trend");
    expect(result.reasonCodes).toContain("age_over_65_clinician_check");
    expect(result.warning).toContain("clinician");
  });

  it("does not soften the injury/illness/medication adjustment for a 65+ athlete", () => {
    const result = calculateMafHr({ age: 70, injuryIllnessMedication: true, consistency: "high", trend: "improving" });
    expect(result.adjustment).toBe(-10);
    expect(result.reasonCodes).not.toContain("age_over_65_clinician_check");
  });

  it("never drops the ceiling by more than a year of age across any boundary", () => {
    const profile = { injuryIllnessMedication: false, consistency: "high", trend: "improving" } as const;
    for (let age = 16; age < 99; age++) {
      const younger = calculateMafHr({ ...profile, age });
      const older = calculateMafHr({ ...profile, age: age + 1 });
      expect(younger.ceiling - older.ceiling).toBeLessThanOrEqual(1);
    }
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

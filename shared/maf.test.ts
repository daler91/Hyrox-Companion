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

  it("uses Maffetone's flat 165 for under-16s, not 180-age-10 (audit L9)", () => {
    // The old branch computed 180-15-10 = 155 and this test certified it.
    // Maffetone's published rule for under-16s is a flat 165, full stop.
    const result = calculateMafHr({ age: 15, injuryIllnessMedication: false, consistency: "high", trend: "improving" });
    expect(result.ceiling).toBe(165);
    expect(result.warning).toMatch(/Under-16/);
    expect(result.reasonCodes).toContain("age_under_16_fixed_165");
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


describe("calculateMafHr — Maffetone's category question (audit M6)", () => {
  it("maps each category to Maffetone's published adjustment", () => {
    const at = (category: Parameters<typeof calculateMafHr>[0]["category"]) =>
      calculateMafHr({ age: 40, category });

    expect(at("recovering_or_medicated")).toMatchObject({ adjustment: -10, ceiling: 130 });
    expect(at("training_interrupted")).toMatchObject({ adjustment: -5, ceiling: 135 });
    expect(at("consistent_up_to_2y")).toMatchObject({ adjustment: 0, ceiling: 140 });
    expect(at("consistent_2y_plus_improving")).toMatchObject({ adjustment: 5, ceiling: 145 });
  });

  it("prices allergies at -5, not the -10 the legacy boolean charged", () => {
    // The whole point of asking Maffetone's question directly: hay fever is
    // category (b). The legacy proxies had nowhere to put it except the -10
    // recovering/medicated boolean, so it cost twice what he says it costs.
    const withAllergies = calculateMafHr({ age: 40, category: "training_interrupted" });
    const legacyBoolean = calculateMafHr({ age: 40, injuryIllnessMedication: true, consistency: "high", trend: "improving" });

    expect(withAllergies.adjustment).toBe(-5);
    expect(legacyBoolean.adjustment).toBe(-10);
  });

  it("lets the category outrank the legacy proxies when both are supplied", () => {
    // A category answer is Maffetone's own instrument; the proxies are the
    // approximation. When an athlete has answered the real question, the
    // approximation must not override it in either direction.
    const result = calculateMafHr({
      age: 40,
      category: "consistent_2y_plus_improving",
      injuryIllnessMedication: true,
      consistency: "low",
      trend: "declining",
    });

    expect(result.adjustment).toBe(5);
  });

  it("still adds the 65+ clinician note on top of an earned category", () => {
    const result = calculateMafHr({ age: 65, category: "consistent_2y_plus_improving" });
    expect(result.adjustment).toBe(5);
    expect(result.ceiling).toBe(120);
    expect(result.warning).toMatch(/65/);
  });

  it("keeps the legacy derivation bit-for-bit when no category is stored", () => {
    // Existing athletes answered the old questions; their ceilings must not
    // move until they answer the new one.
    const legacy = calculateMafHr({ age: 35, injuryIllnessMedication: false, consistency: "moderate", trend: "flat" });
    expect(legacy).toMatchObject({ adjustment: 0, ceiling: 145 });
  });
});

import { describe, expect, it } from "vitest";

import { analyzeFuellingCorrelation, type FuellingCorrelationDay } from "./fuellingCorrelation";

function day(over: Partial<FuellingCorrelationDay> = {}): FuellingCorrelationDay {
  return { carbG: 300, carbTargetG: 300, avgRpe: null, compliancePct: null, ...over };
}

// 3 hit + 3 miss days (vs a 300g target; hit = ≥270g) with RPE + compliance.
const BALANCED: FuellingCorrelationDay[] = [
  day({ carbG: 300, avgRpe: 6, compliancePct: 90 }),
  day({ carbG: 290, avgRpe: 6.5, compliancePct: 88 }),
  day({ carbG: 270, avgRpe: 6.4, compliancePct: 86 }),
  day({ carbG: 150, avgRpe: 7.5, compliancePct: 78 }),
  day({ carbG: 180, avgRpe: 7.2, compliancePct: 74 }),
  day({ carbG: 200, avgRpe: 7.3, compliancePct: 82 }),
];

describe("analyzeFuellingCorrelation", () => {
  it("compares RPE and compliance across carb-hit vs carb-miss days", () => {
    const out = analyzeFuellingCorrelation(BALANCED);

    expect(out.status).toBe("ok");
    expect(out.eligibleDays).toBe(6);
    expect(out.rpe).toEqual({ hitDays: 3, missDays: 3, hitAvg: 6.3, missAvg: 7.3, delta: -1 });
    expect(out.compliance).toEqual({ hitDays: 3, missDays: 3, hitAvg: 88, missAvg: 78, delta: 10 });
  });

  it("derives the delta from raw means, not the rounded ones", () => {
    const out = analyzeFuellingCorrelation([
      day({ carbG: 300, avgRpe: 6.25 }),
      day({ carbG: 300, avgRpe: 6.25 }),
      day({ carbG: 300, avgRpe: 6.25 }),
      day({ carbG: 100, avgRpe: 7.0 }),
      day({ carbG: 100, avgRpe: 7.0 }),
      day({ carbG: 100, avgRpe: 7.01 }),
    ]);

    // Raw means 6.25 vs 7.0033… → delta −0.75… → −0.8. Differencing the
    // rounded averages (6.3 − 7.0) would misreport −0.7.
    expect(out.rpe).toMatchObject({ hitAvg: 6.3, missAvg: 7.0, delta: -0.8 });
  });

  it("treats exactly 90% of the target as a hit", () => {
    const out = analyzeFuellingCorrelation([
      ...BALANCED.slice(3), // 3 miss days
      day({ carbG: 270, avgRpe: 6, compliancePct: 90 }), // 270 = 0.9 × 300 → hit
      day({ carbG: 269.9, avgRpe: 9, compliancePct: 10 }), // just under → miss
      day({ carbG: 280, avgRpe: 6, compliancePct: 90 }),
      day({ carbG: 290, avgRpe: 6, compliancePct: 90 }),
    ]);

    expect(out.rpe?.hitDays).toBe(3);
    expect(out.rpe?.missDays).toBe(4);
  });

  it("returns insufficient_data with reasons under the min-N guard", () => {
    const out = analyzeFuellingCorrelation(BALANCED.slice(0, 4)); // 3 hit, 1 miss

    expect(out.status).toBe("insufficient_data");
    expect(out.rpe).toBeNull();
    expect(out.compliance).toBeNull();
    expect(out.reasonCodes).toContain("insufficient_rpe_days");
    expect(out.reasonCodes).toContain("insufficient_compliance_days");
  });

  it("reports one metric when only it has enough data", () => {
    const rpeOnly = BALANCED.map((d) => ({ ...d, compliancePct: null }));
    const out = analyzeFuellingCorrelation(rpeOnly);

    expect(out.status).toBe("ok");
    expect(out.rpe).not.toBeNull();
    expect(out.compliance).toBeNull();
  });

  it("excludes days without a carb target or without any training outcome", () => {
    const out = analyzeFuellingCorrelation([
      ...BALANCED,
      day({ carbTargetG: null, avgRpe: 5 }), // no target → "hit" undefined
      day({ carbTargetG: 0, avgRpe: 5 }), // zero target → excluded
      day({ carbG: 300 }), // rest day (no rpe/compliance)
    ]);

    expect(out.eligibleDays).toBe(6);
  });

  it("flags an empty range", () => {
    const out = analyzeFuellingCorrelation([]);

    expect(out.status).toBe("insufficient_data");
    expect(out.eligibleDays).toBe(0);
    expect(out.reasonCodes).toContain("no_eligible_days");
  });
});

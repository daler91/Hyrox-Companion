import { describe, expect, it } from "vitest";

import { calculateMafHr } from "./maf";

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
});

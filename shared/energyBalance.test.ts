import { describe, expect, it } from "vitest";

import { computeEnergyBalance } from "./energyBalance";

// Male 75kg / 180cm / 30y → Mifflin–St Jeor BMR = 750 + 1125 − 150 + 5 = 1730.
const PROFILE = {
  bodyweightKg: 75,
  heightCm: 180,
  ageYears: 30,
  sex: "male" as const,
  activityLevel: "moderate" as const,
};

describe("computeEnergyBalance", () => {
  it("uses measured workout calories on top of a sedentary base (no double-counting)", () => {
    const out = computeEnergyBalance({ ...PROFILE, intakeKcal: 2500, measuredActiveKcal: 600 });

    expect(out).toMatchObject({
      basis: "measured",
      bmrKcal: 1730,
      activeKcal: 600,
      outKcal: 2676, // 1730 × 1.2 + 600
      inKcal: 2500,
      balanceKcal: -176,
    });
    expect(out?.reasonCodes).toContain("measured_active_kcal");
  });

  it("estimates from the static activity multiplier when nothing was measured", () => {
    const out = computeEnergyBalance({ ...PROFILE, intakeKcal: 2500, measuredActiveKcal: null });

    expect(out).toMatchObject({ basis: "estimated", outKcal: 2682 }); // 1730 × 1.55
    expect(out?.explanation).toContain("Connect Strava or Garmin");
  });

  it("treats zero measured calories as unmeasured", () => {
    const out = computeEnergyBalance({ ...PROFILE, intakeKcal: 2000, measuredActiveKcal: 0 });
    expect(out?.basis).toBe("estimated");
  });

  it("assumes a moderate activity level when none is set", () => {
    const out = computeEnergyBalance({
      ...PROFILE,
      activityLevel: null,
      intakeKcal: 2000,
      measuredActiveKcal: null,
    });

    expect(out?.outKcal).toBe(2682);
    expect(out?.reasonCodes).toContain("assumed_moderate_activity");
  });

  it("uses the sex-neutral BMR midpoint when sex is unknown", () => {
    const out = computeEnergyBalance({
      ...PROFILE,
      sex: null,
      intakeKcal: 2000,
      measuredActiveKcal: 500,
    });

    expect(out?.bmrKcal).toBe(1647); // 750 + 1125 − 150 − 78
    expect(out?.reasonCodes).toContain("sex_neutral_bmr");
  });

  it("returns null when the BMR profile is incomplete", () => {
    expect(
      computeEnergyBalance({
        ...PROFILE,
        heightCm: null,
        intakeKcal: 2000,
        measuredActiveKcal: 600,
      }),
    ).toBeNull();
    expect(
      computeEnergyBalance({ ...PROFILE, ageYears: 0, intakeKcal: 2000, measuredActiveKcal: 600 }),
    ).toBeNull();
  });

  it("clamps negative intake to zero", () => {
    const out = computeEnergyBalance({ ...PROFILE, intakeKcal: -50, measuredActiveKcal: 600 });
    expect(out?.inKcal).toBe(0);
    expect(out?.balanceKcal).toBe(-2676);
  });
});

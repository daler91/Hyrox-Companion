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

describe("energy balance — a rest day must not out-burn a real session (audit H14)", () => {
  const athlete = {
    intakeKcal: 2500,
    bodyweightKg: 80,
    heightCm: 182,
    ageYears: 30,
    sex: "male" as const,
    activityLevel: "very_active" as const,
  };

  it("credits no training on a day with nothing logged", () => {
    const rest = computeEnergyBalance({ ...athlete, measuredActiveKcal: null, loggedSessionCount: 0 })!;
    expect(rest.activeKcal).toBe(0);
    expect(rest.reasonCodes).toContain("no_training_logged");
    // Daily living only, so an ordinary intake is a surplus on a rest day.
    expect(rest.balanceKcal).toBeGreaterThan(0);
  });

  it("no longer reports a bigger burn for a rest day than for a measured session", () => {
    // The inversion: an unmeasured rest day used to be credited 1613 kcal of
    // "training" for a very_active athlete, against 600 for a real synced
    // session — so measuring a genuine workout made the app think the athlete
    // had burned 655 kcal LESS that day.
    const rest = computeEnergyBalance({ ...athlete, measuredActiveKcal: null, loggedSessionCount: 0 })!;
    const measured = computeEnergyBalance({ ...athlete, measuredActiveKcal: 600, loggedSessionCount: 1 })!;

    expect(rest.activeKcal).toBeLessThan(measured.activeKcal);
    expect(rest.outKcal).toBeLessThan(measured.outKcal);
  });

  it("still estimates from the typical day when a session was logged but not measured", () => {
    const unmeasured = computeEnergyBalance({ ...athlete, measuredActiveKcal: null, loggedSessionCount: 1 })!;
    expect(unmeasured.basis).toBe("estimated");
    expect(unmeasured.activeKcal).toBeGreaterThan(0);
    expect(unmeasured.reasonCodes).toContain("typical_day_activity_estimate");
    // And says so, rather than implying it measured today.
    expect(unmeasured.explanation).toContain("TYPICAL day");
  });

  it("measures active calories above daily living on both paths", () => {
    // The estimated path used to report tdee − bmr, folding in the non-exercise
    // living that the measured path accounts for separately, so the two numbers
    // were not comparable.
    const measured = computeEnergyBalance({ ...athlete, measuredActiveKcal: 600, loggedSessionCount: 1 })!;
    expect(measured.outKcal - measured.activeKcal).toBe(
      computeEnergyBalance({ ...athlete, measuredActiveKcal: null, loggedSessionCount: 0 })!.outKcal,
    );
  });

  it("keeps the old typical-day estimate for a caller that cannot say what was logged", () => {
    const legacy = computeEnergyBalance({ ...athlete, measuredActiveKcal: null })!;
    expect(legacy.basis).toBe("estimated");
    expect(legacy.activeKcal).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";

import {
  calculateBmr,
  calculateNutritionTarget,
  defaultPeriodizationConfig,
  effectiveTarget,
  effectiveTargetWindowed,
  type PeriodizationConfig,
  type TrainingLoadWindow,
} from "./nutritionTargets";

describe("calculateBmr (Mifflin–St Jeor)", () => {
  const body = { bodyweightKg: 80, heightCm: 180, ageYears: 30 };

  it("uses +5 for male", () => {
    // 10*80 + 6.25*180 − 5*30 + 5
    expect(calculateBmr({ ...body, sex: "male" })).toBe(1780);
  });

  it("uses −161 for female", () => {
    expect(calculateBmr({ ...body, sex: "female" })).toBe(1614);
  });

  it("uses the −78 midpoint when sex is unknown", () => {
    expect(calculateBmr({ ...body, sex: null })).toBe(1697);
  });
});

describe("calculateNutritionTarget", () => {
  const base = {
    bodyweightKg: 80,
    heightCm: 180,
    ageYears: 30,
    sex: "male" as const,
    activityLevel: "moderate" as const,
  };

  it("maintains at TDEE with no goal delta and fills carbs with the remainder", () => {
    const r = calculateNutritionTarget({ ...base, goalDirection: "maintain", goalRateKgPerWeek: 0 });
    expect(r.bmr).toBe(1780);
    expect(r.tdee).toBe(2759); // 1780 × 1.55
    expect(r.goalCalorieDelta).toBe(0);
    expect(r.calories).toBe(2759);
    expect(r.proteinG).toBe(144); // 1.8 × 80
    expect(r.fatG).toBe(80); // 1.0 × 80
    expect(r.carbG).toBe(365.8); // (2759 − 1296) / 4
    expect(r.reasonCodes).toHaveLength(0);
    expect(r.warning).toBeNull();
  });

  it("applies a deficit when losing (−rate × 7700 / 7)", () => {
    const r = calculateNutritionTarget({ ...base, goalDirection: "lose", goalRateKgPerWeek: 0.5 });
    expect(r.goalCalorieDelta).toBe(-550);
    expect(r.calories).toBe(2209);
  });

  it("applies a surplus when gaining", () => {
    const r = calculateNutritionTarget({ ...base, goalDirection: "gain", goalRateKgPerWeek: 0.25 });
    expect(r.goalCalorieDelta).toBe(275);
    expect(r.calories).toBe(3034);
  });

  it("floors calories for safety and flags it", () => {
    const r = calculateNutritionTarget({
      bodyweightKg: 50,
      heightCm: 160,
      ageYears: 60,
      sex: "female",
      activityLevel: "sedentary",
      goalDirection: "lose",
      goalRateKgPerWeek: 1.0,
    });
    expect(r.calories).toBe(1200); // floored from ~147
    expect(r.reasonCodes).toContain("calorie_floor_applied");
    expect(r.warning).toMatch(/floored/i);
  });

  it("clamps carbs to zero and re-raises calories to the protein+fat floor", () => {
    const r = calculateNutritionTarget({
      bodyweightKg: 120,
      heightCm: 175,
      ageYears: 40,
      sex: "male",
      activityLevel: "sedentary",
      goalDirection: "lose",
      goalRateKgPerWeek: 1.5,
    });
    expect(r.carbG).toBe(0);
    expect(r.reasonCodes).toContain("carbs_clamped_zero");
    // protein 216g + fat 120g = 864 + 1080 = 1944 kcal
    expect(r.calories).toBe(1944);
  });

  it("honours overridden g/kg anchors", () => {
    const r = calculateNutritionTarget({
      ...base,
      goalDirection: "maintain",
      goalRateKgPerWeek: 0,
      proteinGPerKg: 2.2,
      fatGPerKg: 0.8,
    });
    expect(r.proteinG).toBe(176); // 2.2 × 80
    expect(r.fatG).toBe(64); // 0.8 × 80
  });

  it("flags a sex-neutral estimate when sex is unknown", () => {
    const r = calculateNutritionTarget({
      ...base,
      sex: null,
      goalDirection: "maintain",
      goalRateKgPerWeek: 0,
    });
    expect(r.reasonCodes).toContain("sex_neutral_bmr");
  });
});

describe("effectiveTarget (load periodisation)", () => {
  const baseTarget = { calories: 2000, proteinG: 150, carbG: 200, fatG: 60 };

  it("passes through unchanged when periodisation is disabled", () => {
    const r = effectiveTarget(baseTarget, 80, { enabled: false, referenceUtss: 50, carbGramsPerUtss: 2 });
    expect(r.scaled).toBe(false);
    expect(r.carbG).toBe(200);
    expect(r.calories).toBe(2000);
    expect(r.carbDeltaG).toBe(0);
  });

  it("passes through when there is no carb baseline to scale", () => {
    const r = effectiveTarget(
      { calories: 2000, proteinG: 150, carbG: null, fatG: 60 },
      80,
      { enabled: true, referenceUtss: 50, carbGramsPerUtss: 2 },
    );
    expect(r.scaled).toBe(false);
    expect(r.carbDeltaG).toBe(0);
  });

  it("adds carbs and calories above the reference load", () => {
    const r = effectiveTarget(baseTarget, 80, { enabled: true, referenceUtss: 50, carbGramsPerUtss: 2 });
    expect(r.scaled).toBe(true);
    expect(r.carbDeltaG).toBe(60); // (80 − 50) × 2
    expect(r.carbG).toBe(260);
    expect(r.calories).toBe(2240); // 2000 + 60 × 4
    expect(r.proteinG).toBe(150); // unchanged
    expect(r.fatG).toBe(60); // unchanged
  });

  it("floors carbs at zero on a rest day and reports the applied (post-floor) delta", () => {
    const r = effectiveTarget(
      { calories: 2000, proteinG: 150, carbG: 100, fatG: 60 },
      0,
      { enabled: true, referenceUtss: 50, carbGramsPerUtss: 3 },
    );
    // raw delta would be (0 − 50) × 3 = −150, but carbs floor at 0
    expect(r.carbG).toBe(0);
    expect(r.carbDeltaG).toBe(-100); // post-floor: 0 − 100
    expect(r.calories).toBe(1600); // 2000 + (−100 × 4)
  });
});

describe("effectiveTargetWindowed (past + future training)", () => {
  const base = { calories: 2000, proteinG: 150, carbG: 200, fatG: 60 };
  const emptyWindow = (dayUtss: number): TrainingLoadWindow => ({
    dayUtss,
    recentLoads: [],
    acuteEwma: null,
    chronicEwma: null,
    tsb: null,
    upcoming: [],
    phase: null,
    daysUntilRace: null,
  });
  const loadCfg: PeriodizationConfig = { enabled: true, referenceUtss: 50, carbGramsPerUtss: 2 };

  it("matches the single-day path when the window is empty", () => {
    const w = effectiveTargetWindowed(base, emptyWindow(80), loadCfg);
    const single = effectiveTarget(base, 80, loadCfg);
    expect(w.carbG).toBe(single.carbG);
    expect(w.carbDeltaG).toBe(single.carbDeltaG);
    expect(w.baseLoadDeltaG).toBe(60);
    expect(w.recoveryDeltaG).toBe(0);
    expect(w.preloadDeltaG).toBe(0);
  });

  it("keeps carbs up for recovery on a light day after a hard block, and bumps protein", () => {
    const window: TrainingLoadWindow = {
      ...emptyWindow(0), // rest day today
      recentLoads: [80, 90, 70], // hard recent days
      acuteEwma: 80,
      tsb: -20, // fatigued
    };
    const r = effectiveTargetWindowed(base, window, { ...loadCfg, recoveryEnabled: true });
    // base load alone would floor carbs toward 100 ((0−50)×2 = −100); recovery
    // refills, landing at 180 instead.
    expect(r.baseLoadDeltaG).toBe(-100);
    expect(r.recoveryDeltaG).toBe(80);
    expect(r.carbDeltaG).toBe(-20);
    expect(r.carbG).toBe(180);
    expect(r.proteinDeltaG).toBe(22.5); // 0.15 × 150 × intensity(=1)
    expect(r.proteinG).toBe(172.5);
    expect(r.calories).toBe(2010); // 2000 + (−20×4) + (22.5×4)
    expect(r.reasonCodes).toContain("recovery_topup");
  });

  it("does not apply recovery when the knob is off", () => {
    const window: TrainingLoadWindow = { ...emptyWindow(0), recentLoads: [80, 90, 70], acuteEwma: 80 };
    const r = effectiveTargetWindowed(base, window, loadCfg);
    expect(r.recoveryDeltaG).toBe(0);
    expect(r.proteinDeltaG).toBe(0);
    expect(r.carbG).toBe(100); // pure single-day floor behaviour
  });

  it("pre-loads carbs the day before a big planned session", () => {
    const window: TrainingLoadWindow = {
      ...emptyWindow(40),
      upcoming: [{ daysAhead: 1, plannedUtss: 120 }],
    };
    const r = effectiveTargetWindowed(base, window, {
      ...loadCfg,
      preloadCarbGramsPerUtss: 1.5,
      preloadDaysAhead: 1,
    });
    expect(r.preloadDeltaG).toBe(105); // (120−50)×1.5×(1/1)
    expect(r.baseLoadDeltaG).toBe(-20); // (40−50)×2
    expect(r.carbDeltaG).toBe(85);
    expect(r.carbG).toBe(285);
    expect(r.reasonCodes).toContain("carb_preload");
  });

  it("ignores upcoming sessions beyond the pre-load horizon", () => {
    const window: TrainingLoadWindow = {
      ...emptyWindow(40),
      upcoming: [{ daysAhead: 2, plannedUtss: 120 }],
    };
    const r = effectiveTargetWindowed(base, window, {
      ...loadCfg,
      preloadCarbGramsPerUtss: 1.5,
      preloadDaysAhead: 1,
    });
    expect(r.preloadDeltaG).toBe(0);
    expect(r.carbG).toBe(180); // base load only
  });

  it("carb-loads through race week and damps training carbs in the taper", () => {
    const raceWeek = effectiveTargetWindowed(
      base,
      { ...emptyWindow(30), phase: "race_week" },
      { ...loadCfg, phaseAware: true },
    );
    expect(raceWeek.preloadDeltaG).toBe(50); // 0.25 × 200
    expect(raceWeek.carbDeltaG).toBe(10); // −40 base + 50 race-week
    expect(raceWeek.reasonCodes).toContain("race_week");

    const taper = effectiveTargetWindowed(
      base,
      { ...emptyWindow(100), phase: "taper" },
      { ...loadCfg, phaseAware: true },
    );
    expect(taper.baseLoadDeltaG).toBe(85); // (100−50)×2 = 100, damped ×0.85
    expect(taper.reasonCodes).toContain("taper");
  });

  it("caps the combined carb delta and keeps components summing to the total", () => {
    const window: TrainingLoadWindow = {
      ...emptyWindow(60),
      upcoming: [{ daysAhead: 1, plannedUtss: 150 }],
    };
    const r = effectiveTargetWindowed(base, window, {
      ...loadCfg,
      preloadCarbGramsPerUtss: 2,
      preloadDaysAhead: 1,
      maxCarbDeltaG: 60,
    });
    expect(r.carbDeltaG).toBe(60);
    expect(r.baseLoadDeltaG + r.recoveryDeltaG + r.preloadDeltaG).toBe(60);
    expect(r.carbG).toBe(260);
    expect(r.reasonCodes).toContain("carb_delta_capped");
  });

  it("passes through untouched when periodisation is disabled, even with a rich window", () => {
    const window: TrainingLoadWindow = {
      ...emptyWindow(0),
      recentLoads: [90, 90],
      upcoming: [{ daysAhead: 1, plannedUtss: 150 }],
      phase: "race_week",
    };
    const r = effectiveTargetWindowed(base, window, {
      enabled: false,
      referenceUtss: 50,
      carbGramsPerUtss: 2,
      recoveryEnabled: true,
      phaseAware: true,
      preloadCarbGramsPerUtss: 2,
    });
    expect(r.scaled).toBe(false);
    expect(r.carbG).toBe(200);
    expect(r.proteinG).toBe(150);
    expect(r.carbDeltaG).toBe(0);
  });
});

describe("defaultPeriodizationConfig", () => {
  it("references the recent average load with a half-proportional slope", () => {
    const c = defaultPeriodizationConfig(300, 60);
    expect(c.referenceUtss).toBe(60);
    expect(c.carbGramsPerUtss).toBe(2.5); // (300 / 60) × 0.5
  });

  it("falls back to a sane reference when there is no load history", () => {
    const c = defaultPeriodizationConfig(300, 0);
    expect(c.referenceUtss).toBe(50);
    expect(c.carbGramsPerUtss).toBe(3); // (300 / 50) × 0.5
  });

  it("floors a near-zero recent average so the slope can't explode", () => {
    // Without the floor, referenceUtss = 3 → carbGramsPerUtss = 50, so a single
    // 50 UTSS day would add ~2350 g of carbs. Floored at 25 it stays bounded.
    const c = defaultPeriodizationConfig(300, 3);
    expect(c.referenceUtss).toBe(25);
    expect(c.carbGramsPerUtss).toBe(6); // (300 / 25) × 0.5
  });
});

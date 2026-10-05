import type { TrainingLoadWindow } from "@shared/nutritionTargets";
import type { BlockViewPoint, MealType, NutritionTarget } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { buildFuellingRange, decorateBlockPointsWithOutcomes, rangeLoadNeeds } from "./fuellingRange";
import type { LogEntryWithFood } from "./rollup";

/** A minimal joined entry — only the fields the range builder/rollup read. */
function row(
  logDate: string,
  mealType: MealType,
  opts: { cal?: number; protein?: number; quantityG?: number } = {},
): LogEntryWithFood {
  return {
    logDate,
    mealType,
    quantityG: opts.quantityG ?? 100,
    food: {
      caloriesPer100g: opts.cal ?? 0,
      proteinPer100g: opts.protein ?? 0,
      carbPer100g: 0,
      fatPer100g: 0,
      fiberPer100g: 0,
    },
  } as unknown as LogEntryWithFood;
}

function target(effectiveFrom: string, opts: Partial<NutritionTarget> = {}): NutritionTarget {
  return {
    effectiveFrom,
    calories: 2000,
    proteinG: 150,
    carbG: 250,
    fatG: 60,
    periodizationEnabled: false,
    referenceUtss: null,
    carbGramsPerUtss: null,
    ...opts,
  } as NutritionTarget;
}

function point(date: string, over: Partial<BlockViewPoint> = {}): BlockViewPoint {
  return { date, calories: 0, protein: 0, carb: 0, fat: 0, fiber: 0, utss: 0, ...over };
}

describe("buildFuellingRange", () => {
  it("fills every day in the range with zero totals and a null target when there's no data", () => {
    const days = buildFuellingRange([], [], [], { from: "2026-06-01", to: "2026-06-03" });
    expect(days.map((d) => d.date)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    for (const d of days) {
      expect(d.totals).toEqual({ calories: 0, protein: 0, carb: 0, fat: 0, fiber: 0 });
      expect(d.effectiveTarget).toBeNull();
      expect(d.hasPostWorkoutFuel).toBe(false);
    }
  });

  it("sums each day's intake and flags days with a post-workout meal", () => {
    const rows = [
      row("2026-06-02", "lunch", { cal: 500 }),
      row("2026-06-02", "post_workout", { cal: 300, protein: 30 }),
    ];
    const days = buildFuellingRange(rows, [], [], { from: "2026-06-01", to: "2026-06-02" });
    expect(days[0]).toMatchObject({ date: "2026-06-01", hasPostWorkoutFuel: false });
    expect(days[0].totals.calories).toBe(0);
    expect(days[1]).toMatchObject({ date: "2026-06-02", hasPostWorkoutFuel: true });
    expect(days[1].totals.calories).toBe(800);
    expect(days[1].totals.protein).toBe(30);
  });

  it("attaches a flat effective target when periodisation is off", () => {
    const days = buildFuellingRange([], [], [target("2026-06-01")], {
      from: "2026-06-01",
      to: "2026-06-02",
    });
    for (const d of days) {
      expect(d.effectiveTarget).toMatchObject({
        calories: 2000,
        carbG: 250,
        carbDeltaG: 0,
        scaled: false,
        utss: 0,
      });
    }
  });

  it("scales carbs/calories by each day's training load when periodised", () => {
    const periodised = target("2026-06-01", {
      periodizationEnabled: true,
      referenceUtss: 50,
      carbGramsPerUtss: 1,
    });
    const days = buildFuellingRange(
      [],
      [{ date: "2026-06-02", utss: 100 }],
      [periodised],
      { from: "2026-06-01", to: "2026-06-02" },
    );
    // Day 1: no load → utss 0 → carbs 250 + (0-50) = 200, calories 2000 - 200 = 1800.
    expect(days[0].effectiveTarget).toMatchObject({
      carbG: 200,
      calories: 1800,
      carbDeltaG: -50,
      scaled: true,
      utss: 0,
    });
    // Day 2: UTSS 100 → carbs 250 + (100-50) = 300, calories 2000 + 200 = 2200.
    expect(days[1].effectiveTarget).toMatchObject({
      carbG: 300,
      calories: 2200,
      carbDeltaG: 50,
      scaled: true,
      utss: 100,
    });
  });

  it("resolves the target version effective on each date", () => {
    const targets = [
      target("2026-06-01", { calories: 2000 }),
      target("2026-06-03", { calories: 2500 }),
    ];
    const days = buildFuellingRange([], [], targets, { from: "2026-06-02", to: "2026-06-03" });
    expect(days[0].effectiveTarget?.calories).toBe(2000); // 06-02 → 06-01 version
    expect(days[1].effectiveTarget?.calories).toBe(2500); // 06-03 → 06-03 version
  });

  it("leaves the target null for dates before any version's effectiveFrom", () => {
    const days = buildFuellingRange([], [], [target("2026-06-05")], {
      from: "2026-06-04",
      to: "2026-06-05",
    });
    expect(days[0].effectiveTarget).toBeNull(); // before the first target
    expect(days[1].effectiveTarget).not.toBeNull();
  });
});

// C31 (CODEBASE_ANALYSIS_2026-10-03): the range used to give every day the
// single-day window; an adaptive target now reads the window the daily
// summary reads, and only for the days whose target needs one.
describe("adaptive targets in the fuelling range (C31)", () => {
  const adaptive = (effectiveFrom: string, opts: Partial<NutritionTarget> = {}) =>
    target(effectiveFrom, {
      periodizationEnabled: true,
      referenceUtss: 50,
      carbGramsPerUtss: 1,
      recoveryEnabled: true,
      preloadCarbGramsPerUtss: 1,
      preloadDaysAhead: 1,
      ...opts,
    });

  const ONE_DAY = { from: "2026-06-01", to: "2026-06-01" };

  const window = (over: Partial<TrainingLoadWindow> = {}): TrainingLoadWindow => ({
    dayUtss: 50,
    recentLoads: [90, 90, 90, 90, 90, 90, 90],
    acuteEwma: 90,
    chronicEwma: 80,
    tsb: -10,
    upcoming: [{ daysAhead: 1, plannedUtss: 120 }],
    phase: "build",
    daysUntilRace: 40,
    ...over,
  });

  it("asks for windows only on adaptive days, and for the plan only if one reads it", () => {
    const loadOnly = { periodizationEnabled: true, referenceUtss: 50, carbGramsPerUtss: 1 };
    const targets = [
      target("2026-06-01"), // flat
      target("2026-06-02", loadOnly),
      adaptive("2026-06-03", { preloadCarbGramsPerUtss: 0, phaseAware: false }), // recovery only
    ];
    expect(rangeLoadNeeds(targets, { from: "2026-06-01", to: "2026-06-04" })).toEqual({
      dayUtss: true,
      windowDates: ["2026-06-03", "2026-06-04"],
      includeFuture: false,
    });
    const withPlan = rangeLoadNeeds([target("2026-06-01"), adaptive("2026-06-02")], {
      from: "2026-06-01",
      to: "2026-06-02",
    });
    expect(withPlan).toEqual({ dayUtss: false, windowDates: ["2026-06-02"], includeFuture: true });
  });

  it("builds an adaptive day's target from its window, recovery and pre-load included", () => {
    const windows = new Map([["2026-06-01", window()]]);
    const [day] = buildFuellingRange([], [], [adaptive("2026-06-01")], ONE_DAY, windows);
    expect(day.effectiveTarget).toMatchObject({
      recoveryDeltaG: 20, // (90 − 50) × 1 × 0.5
      preloadDeltaG: 70, // (120 − 50) × 1 ÷ 1 day ahead
      phase: "build",
    });
  });

  it("drops the upcoming plan from a window whose target does not read it", () => {
    const recoveryOnly = adaptive("2026-06-01", { preloadCarbGramsPerUtss: 0, phaseAware: false });
    const windows = new Map([["2026-06-01", window()]]);
    const [day] = buildFuellingRange([], [], [recoveryOnly], ONE_DAY, windows);
    expect(day.effectiveTarget).toMatchObject({
      recoveryDeltaG: 20,
      preloadDeltaG: 0,
      phase: null,
    });
  });
});

describe("decorateBlockPointsWithOutcomes", () => {
  it("attaches the day's carb target and averages multi-workout outcomes", () => {
    const points = decorateBlockPointsWithOutcomes(
      [point("2026-06-01"), point("2026-06-02")],
      [
        { date: "2026-06-02", rpe: 6, compliancePct: 80 },
        { date: "2026-06-02", rpe: 7, compliancePct: 90 },
      ],
      [target("2026-06-01")],
      [],
    );

    // Rest day: target resolves, outcomes null.
    expect(points[0]).toMatchObject({ carbTargetG: 250, avgRpe: null, compliancePct: null });
    // Training day: outcomes averaged across the day's workouts.
    expect(points[1]).toMatchObject({ carbTargetG: 250, avgRpe: 6.5, compliancePct: 85 });
  });

  it("scales a periodised carb target by the day's UTSS and skips unrecorded metrics", () => {
    const points = decorateBlockPointsWithOutcomes(
      [point("2026-06-02", { utss: 100 })],
      [
        { date: "2026-06-02", rpe: null, compliancePct: null },
        { date: "2026-06-02", rpe: 8, compliancePct: null },
      ],
      [target("2026-06-01", { periodizationEnabled: true, referenceUtss: 50, carbGramsPerUtss: 1 })],
      [{ date: "2026-06-02", utss: 100 }],
    );

    // 250g + (100 − 50) × 1 = 300g; null RPEs don't drag the average down.
    expect(points[0]).toMatchObject({ carbTargetG: 300, avgRpe: 8, compliancePct: null });
  });

  it("derives the carb target from the RAW UTSS, matching the other endpoints", () => {
    const points = decorateBlockPointsWithOutcomes(
      // The point carries the display-rounded value (42.3)…
      [point("2026-06-02", { utss: 42.3 })],
      [],
      [target("2026-06-01", { periodizationEnabled: true, referenceUtss: 50, carbGramsPerUtss: 2 })],
      // …but the target must use the raw load: 250 + (42.34 − 50) × 2 = 234.68 → 234.7.
      [{ date: "2026-06-02", utss: 42.34 }],
    );

    expect(points[0].carbTargetG).toBe(234.7); // rounded-utss math would give 234.6
  });

  it("leaves the carb target null before any target version applies", () => {
    const points = decorateBlockPointsWithOutcomes(
      [point("2026-06-01")],
      [],
      [target("2026-06-05")],
      [],
    );
    expect(points[0].carbTargetG).toBeNull();
  });
});

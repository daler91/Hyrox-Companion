import { describe, expect, it } from "vitest";

import {
  type Per100gMacros,
  roundMacros,
  scaleNutrition,
  totalNutrition,
} from "./nutritionScaling";

const BANANA: Per100gMacros = {
  caloriesPer100g: 89,
  proteinPer100g: 1.1,
  carbPer100g: 22.8,
  fatPer100g: 0.3,
  fiberPer100g: 2.6,
};

describe("scaleNutrition", () => {
  it("scales per-100g values by grams, unrounded", () => {
    const n = scaleNutrition(BANANA, 118);

    expect(n.calories).toBeCloseTo(105.02, 5);
    expect(n.protein).toBeCloseTo(1.298, 5);
  });

  it("never produces NaN from an absent value", () => {
    const n = scaleNutrition({ ...BANANA, proteinPer100g: null }, 100);

    expect(n.protein).toBe(0);
    expect(Number.isNaN(n.protein)).toBe(false);
  });
});

describe("energy for a food whose provider published none", () => {
  // This test used to assert `calories === 0` for exactly this input. That was
  // the defect, not the contract: OFF admits a product with no energy field
  // whenever completeness is decent or unknown, and neither the USDA nor the
  // Edamam mapper gates on calories at all — so a real food carrying real
  // macros logged as zero calories, and the day header showed a calorie total
  // that its own protein and carb figures contradicted.
  const noEnergy: Per100gMacros = { ...BANANA, caloriesPer100g: null };

  it("reconstructs it from the macros instead of logging zero", () => {
    // 4(1.1) + 4(22.8) + 9(0.3) = 98.3 kcal per 100 g. The banana's own stated
    // value is 89, so the reconstruction is +10.4% — the high end of the
    // measured range, because fibre is where providers disagree.
    expect(scaleNutrition(noEnergy, 100).calories).toBeCloseTo(98.3, 5);
    expect(scaleNutrition(noEnergy, 200).calories).toBeCloseTo(196.6, 5);
  });

  it("never overrides an energy value the provider DID publish", () => {
    // The reconstruction must be a fallback, never a correction: 89 is what
    // this food says it is, and 98.3 is only an estimate of it.
    expect(scaleNutrition(BANANA, 100).calories).toBe(89);
  });

  it("still reports zero when there is nothing to reconstruct from", () => {
    // A fibre-only food — which sanitizeMappedFood deliberately keeps — has no
    // energy-bearing macro, so there is no honest number to derive. Fabricating
    // one would be worse than the zero.
    const fiberOnly: Per100gMacros = {
      caloriesPer100g: null,
      proteinPer100g: null,
      carbPer100g: null,
      fatPer100g: null,
      fiberPer100g: 2.1,
    };

    expect(scaleNutrition(fiberOnly, 100).calories).toBe(0);
  });

  it("refuses to derive from macros that cannot physically coexist", () => {
    // Each field passes its own import clamp (MACRO_PER_100G_MAX is 200), but
    // 600 g of macros in 100 g of food is not a food. Deriving would assert
    // 3400 kcal per 100 g — nearly four times pure fat, the densest thing
    // there is. Nothing cross-checks the macros against each other on import,
    // so this is the only place that impossibility could become a number.
    const impossible: Per100gMacros = {
      caloriesPer100g: null,
      proteinPer100g: 200,
      carbPer100g: 200,
      fatPer100g: 200,
      fiberPer100g: null,
    };

    expect(scaleNutrition(impossible, 100).calories).toBe(0);
  });

  it("still derives for the densest food that is actually possible", () => {
    // Pure fat: 100 g of fat per 100 g, 900 kcal. The guard must not reject it.
    const oil: Per100gMacros = {
      caloriesPer100g: null,
      proteinPer100g: 0,
      carbPer100g: 0,
      fatPer100g: 100,
      fiberPer100g: null,
    };

    expect(scaleNutrition(oil, 100).calories).toBe(900);
  });

  it("makes the day header agree with its own macros", () => {
    // The bug in one line: 200 g of a food with 50 g protein, 120 g carb and
    // 20 g fat used to total 0 kcal, so a day could read 107 kcal beside 51 g
    // protein and 147 g carb — two numbers in the same object that cannot both
    // be true.
    const proteinPowder: Per100gMacros = {
      caloriesPer100g: null,
      proteinPer100g: 25,
      carbPer100g: 60,
      fatPer100g: 10,
      fiberPer100g: 5,
    };
    const day = totalNutrition([
      { per100g: BANANA, quantityG: 120 },
      { per100g: proteinPowder, quantityG: 200 },
    ]);

    const atwaterOfTheDisplayedMacros =
      4 * day.protein + 4 * day.carb + 9 * day.fat;

    expect(day.calories).toBe(967); // was 107
    expect(Math.abs(day.calories - atwaterOfTheDisplayedMacros)).toBeLessThan(15);
  });
});

describe("the edit preview matches what gets stored (audit M22)", () => {
  // The preview used to rescale the entry's ALREADY-ROUNDED total, so it
  // disagreed with the server, which always rescales the raw per-100g values.
  const previewTheOldWay = (roundedCalories: number, fromGrams: number, toGrams: number) =>
    Math.round(roundedCalories * (toGrams / fromGrams));

  it("agrees with the server on a quantity that rounds badly", () => {
    // 177 g of banana = 157.53 kcal, shown as 158. Double it and the old preview
    // scaled 158 -> 316, while the server stores round(315.06) = 315.
    const stored = roundMacros(scaleNutrition(BANANA, 177)).calories;
    expect(stored).toBe(158);

    const previewNow = roundMacros(scaleNutrition(BANANA, 354)).calories;
    const serverWillStore = roundMacros(scaleNutrition(BANANA, 354)).calories;

    expect(previewTheOldWay(stored, 177, 354)).toBe(316); // the old, wrong preview
    expect(previewNow).toBe(315);
    expect(previewNow).toBe(serverWillStore);
  });

  it("closes a gap whose size depended on how badly the ORIGINAL entry rounded", () => {
    // The old preview inherited the base entry's rounding error and multiplied
    // it. How often it was wrong therefore depends on the base quantity — which
    // is itself the point: the athlete had no way to know which of their entries
    // previewed honestly.
    //
    // Measured over every whole-gram edit from 1 to 500 g:
    //   base 100 g (stored 89, exact)  ->   0 wrong
    //   base 118 g (stored 105)        ->  22 wrong
    //   base  55 g (stored 49)         -> 112 wrong
    //   base 177 g (stored 158)        -> 310 wrong
    //   base  31 g (stored 28)         -> 463 wrong
    const countOldDisagreements = (baseGrams: number) => {
      const stored = roundMacros(scaleNutrition(BANANA, baseGrams)).calories;
      let wrong = 0;
      for (let grams = 1; grams <= 500; grams++) {
        const serverWillStore = roundMacros(scaleNutrition(BANANA, grams)).calories;
        // The fixed preview must agree with the server at every quantity.
        expect(roundMacros(scaleNutrition(BANANA, grams)).calories, `${grams} g`).toBe(
          serverWillStore,
        );
        if (previewTheOldWay(stored, baseGrams, grams) !== serverWillStore) wrong++;
      }
      return wrong;
    };

    expect(countOldDisagreements(100)).toBe(0); // an exact base hid the bug entirely
    expect(countOldDisagreements(177)).toBe(310);
    expect(countOldDisagreements(31)).toBe(463);
  });
});

describe("meal totals reconcile with the day total (audit M22)", () => {
  // Three small portions: 8.9 + 8.9 + 10.68 = 28.48 kcal, which rounds to 28.
  // Rounded individually they are 9 + 9 + 11 = 29.
  const entries = [
    { per100g: BANANA, quantityG: 10 },
    { per100g: BANANA, quantityG: 10 },
    { per100g: BANANA, quantityG: 12 },
  ];

  it("sums raw and rounds once, not the other way round", () => {
    const sumOfRounded = entries
      .map((e) => roundMacros(scaleNutrition(e.per100g, e.quantityG)).calories)
      .reduce((a, b) => a + b, 0);

    expect(sumOfRounded).toBe(29); // what the meal card used to show
    expect(totalNutrition(entries).calories).toBe(28); // what the day header shows
  });

  it("does the same for protein, where 1-dp rounding bites hardest", () => {
    const sumOfRounded = entries
      .map((e) => roundMacros(scaleNutrition(e.per100g, e.quantityG)).protein)
      .reduce((a, b) => a + b, 0);

    expect(sumOfRounded).toBeCloseTo(0.3, 5);
    expect(totalNutrition(entries).protein).toBeCloseTo(0.4, 5);
  });

  it("keeps the meal-vs-day gap bounded by the meal count, not the entry count", () => {
    // The old sum-of-rounded error grew with the number of ENTRIES: twenty small
    // entries could drift ten calories from the day header. Raw-summing per meal
    // bounds the gap at half a unit per MEAL instead, which is inherent to
    // rounding a displayed number at all.
    const many = Array.from({ length: 20 }, () => ({ per100g: BANANA, quantityG: 12 }));

    const oldMealTotal = many
      .map((e) => roundMacros(scaleNutrition(e.per100g, e.quantityG)).calories)
      .reduce((a, b) => a + b, 0);
    const day = totalNutrition(many).calories;

    expect(oldMealTotal - day).toBeGreaterThanOrEqual(5); // the drift that used to show
    expect(totalNutrition(many).calories).toBe(day);

    // Split across two meals: each rounds once, so the gap cannot exceed 1.
    const [first, second] = [many.slice(0, 9), many.slice(9)].map(totalNutrition);
    expect(Math.abs(first.calories + second.calories - day)).toBeLessThanOrEqual(1);
  });
});

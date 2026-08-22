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

  it("treats a null per-100g value as 0, not NaN", () => {
    const n = scaleNutrition({ ...BANANA, caloriesPer100g: null }, 100);

    expect(n.calories).toBe(0);
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

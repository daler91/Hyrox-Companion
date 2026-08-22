import { describe, expect, it } from "vitest";

import { computeRecipeFood, type RecipeIngredientWithFood } from "./recipe";

function food(over: Partial<RecipeIngredientWithFood["food"]> = {}) {
  return {
    caloriesPer100g: 100,
    proteinPer100g: 10,
    carbPer100g: 20,
    fatPer100g: 5,
    fiberPer100g: 2,
    micros: null,
    ...over,
  };
}

describe("computeRecipeFood", () => {
  it("computes weighted per-100g macros and serving size", () => {
    const r = computeRecipeFood(
      [
        { food: food({ caloriesPer100g: 100 }), quantityG: 100 },
        { food: food({ caloriesPer100g: 200 }), quantityG: 100 },
      ],
      2,
    );
    expect(r.totalGrams).toBe(200);
    expect(r.caloriesPer100g).toBe(150); // (100 + 200) / 200 * 100
    expect(r.proteinPer100g).toBe(10);
    expect(r.servingSizeG).toBe(100); // 200g / 2 servings
  });

  it("treats null ingredient macros as 0", () => {
    const r = computeRecipeFood([{ food: food({ caloriesPer100g: null }), quantityG: 100 }], 1);
    expect(r.caloriesPer100g).toBe(0);
  });

  it("aggregates ingredient micronutrients instead of discarding them (audit M21)", () => {
    // The backing food was written with no `micros` at all, so a recipe of
    // USDA-enriched ingredients logged as containing zero micronutrients while
    // the same ingredients logged individually carried theirs.
    const r = computeRecipeFood(
      [
        { food: food({ micros: { sodium: 400, iron: 2 } }), quantityG: 100 },
        { food: food({ micros: { sodium: 200, calcium: 50 } }), quantityG: 100 },
      ],
      2,
    );

    // 400 + 200 = 600 mg over 200 g -> 300 mg per 100 g.
    expect(r.micros).toEqual({ sodium: 300, iron: 1, calcium: 25 });
  });

  it("scales micros by ingredient quantity, not by ingredient count", () => {
    const r = computeRecipeFood(
      [
        { food: food({ micros: { sodium: 100 } }), quantityG: 300 },
        { food: food({ micros: { sodium: 100 } }), quantityG: 100 },
      ],
      1,
    );

    expect(r.micros).toEqual({ sodium: 100 });
  });

  it("leaves micros null when no ingredient carries any", () => {
    // null, not {} — an empty object would read as "measured and found to
    // contain none", which is a different claim.
    const r = computeRecipeFood([{ food: food(), quantityG: 100 }], 1);

    expect(r.micros).toBeNull();
  });

  it("guards against zero total grams", () => {
    const r = computeRecipeFood([], 2);
    expect(r.totalGrams).toBe(0);
    expect(r.caloriesPer100g).toBeNull();
    expect(r.micros).toBeNull();
    expect(r.servingSizeG).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { computeRecipeFood, type RecipeIngredientWithFood } from "./recipe";

function food(over: Partial<RecipeIngredientWithFood["food"]> = {}) {
  return {
    caloriesPer100g: 100,
    proteinPer100g: 10,
    carbPer100g: 20,
    fatPer100g: 5,
    fiberPer100g: 2,
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

  it("guards against zero total grams", () => {
    const r = computeRecipeFood([], 2);
    expect(r.totalGrams).toBe(0);
    expect(r.caloriesPer100g).toBeNull();
    expect(r.servingSizeG).toBeNull();
  });
});

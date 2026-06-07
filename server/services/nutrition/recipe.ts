import type { Food, NutritionMacroTotals } from "@shared/schema";

import { scaleNutrition } from "./rollup";

/**
 * Recipe nutrition math (FR-2.3). A recipe is backed by a custom `foods` row
 * whose per-100g macros are computed here from the ingredient list, so the
 * recipe logs and rolls up through the unchanged Phase 1 path. Reuses
 * `rollup.scaleNutrition` so the scaling rule lives in exactly one place.
 * Pure + DB-free, which is what makes it cheap to test exhaustively.
 */

type Per100gFood = Pick<
  Food,
  "caloriesPer100g" | "proteinPer100g" | "carbPer100g" | "fatPer100g" | "fiberPer100g"
>;

export interface RecipeIngredientWithFood {
  food: Per100gFood;
  quantityG: number;
}

export interface ComputedRecipeFood {
  caloriesPer100g: number | null;
  proteinPer100g: number | null;
  carbPer100g: number | null;
  fatPer100g: number | null;
  fiberPer100g: number | null;
  servingSizeG: number | null;
  totalGrams: number;
}

export function computeRecipeFood(
  ingredients: RecipeIngredientWithFood[],
  servings: number,
): ComputedRecipeFood {
  let totalGrams = 0;
  const totals: NutritionMacroTotals = { calories: 0, protein: 0, carb: 0, fat: 0, fiber: 0 };

  for (const { food, quantityG } of ingredients) {
    totalGrams += quantityG;
    const n = scaleNutrition(food, quantityG);
    totals.calories += n.calories;
    totals.protein += n.protein;
    totals.carb += n.carb;
    totals.fat += n.fat;
    totals.fiber += n.fiber;
  }

  // Defensive: the route validates quantityG > 0, but never divide by zero.
  if (totalGrams <= 0) {
    return {
      caloriesPer100g: null,
      proteinPer100g: null,
      carbPer100g: null,
      fatPer100g: null,
      fiberPer100g: null,
      servingSizeG: null,
      totalGrams: 0,
    };
  }

  const per100 = (total: number) => (total / totalGrams) * 100;
  return {
    caloriesPer100g: per100(totals.calories),
    proteinPer100g: per100(totals.protein),
    carbPer100g: per100(totals.carb),
    fatPer100g: per100(totals.fat),
    fiberPer100g: per100(totals.fiber),
    servingSizeG: servings > 0 ? totalGrams / servings : null,
    totalGrams,
  };
}

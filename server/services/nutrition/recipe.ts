import type { Food, NutritionMacroTotals } from "@shared/schema";

import { scaleMicros, scaleNutrition } from "./rollup";

/**
 * Recipe nutrition math (FR-2.3). A recipe is backed by a custom `foods` row
 * whose per-100g macros are computed here from the ingredient list, so the
 * recipe logs and rolls up through the unchanged Phase 1 path. Reuses
 * `rollup.scaleNutrition` so the scaling rule lives in exactly one place.
 * Pure + DB-free, which is what makes it cheap to test exhaustively.
 */

type Per100gFood = Pick<
  Food,
  "caloriesPer100g" | "proteinPer100g" | "carbPer100g" | "fatPer100g" | "fiberPer100g" | "micros"
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
  /**
   * Aggregated per-100g micronutrients, or null when no ingredient carried any.
   *
   * These used to be dropped on the floor: the recipe's backing food was written
   * with no `micros` at all, so a recipe of USDA-enriched ingredients logged as
   * having zero micronutrients while its ingredients logged individually did not
   * (audit M21). Scaled with `rollup.scaleMicros`, the same helper the daily
   * rollup uses, so the scaling rule stays in one place.
   */
  micros: Record<string, number> | null;
  servingSizeG: number | null;
  totalGrams: number;
}

export function computeRecipeFood(
  ingredients: RecipeIngredientWithFood[],
  servings: number,
): ComputedRecipeFood {
  let totalGrams = 0;
  const totals: NutritionMacroTotals = { calories: 0, protein: 0, carb: 0, fat: 0, fiber: 0 };
  const microTotals: Record<string, number> = {};

  for (const { food, quantityG } of ingredients) {
    totalGrams += quantityG;
    const n = scaleNutrition(food, quantityG);
    totals.calories += n.calories;
    totals.protein += n.protein;
    totals.carb += n.carb;
    totals.fat += n.fat;
    totals.fiber += n.fiber;
    for (const [key, value] of Object.entries(scaleMicros(food.micros, quantityG))) {
      microTotals[key] = (microTotals[key] ?? 0) + value;
    }
  }

  // Defensive: the route validates quantityG > 0, but never divide by zero.
  if (totalGrams <= 0) {
    return {
      caloriesPer100g: null,
      proteinPer100g: null,
      carbPer100g: null,
      fatPer100g: null,
      fiberPer100g: null,
      micros: null,
      servingSizeG: null,
      totalGrams: 0,
    };
  }

  const per100 = (total: number) => (total / totalGrams) * 100;
  const microKeys = Object.keys(microTotals);
  return {
    caloriesPer100g: per100(totals.calories),
    proteinPer100g: per100(totals.protein),
    carbPer100g: per100(totals.carb),
    fatPer100g: per100(totals.fat),
    fiberPer100g: per100(totals.fiber),
    // null, not {}, when nothing carried micros — the column is nullable and an
    // empty object would read as "measured and found to contain none".
    micros: microKeys.length === 0
      ? null
      : Object.fromEntries(microKeys.map((key) => [key, per100(microTotals[key])])),
    servingSizeG: servings > 0 ? totalGrams / servings : null,
    totalGrams,
  };
}

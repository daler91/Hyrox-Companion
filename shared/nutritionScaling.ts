import type { NutritionMacroTotals } from "./schema";

/**
 * The per-100g scaling rule, shared by server and client.
 *
 * This used to live only in `server/services/nutrition/rollup.ts`, so the client
 * could not apply it and scaled ALREADY-ROUNDED totals instead. Two visible
 * consequences (audit M22):
 *
 *   - The edit preview scaled an entry's rounded total by the new quantity, so
 *     the number shown before saving disagreed with the number stored. A 157 kcal
 *     entry (rounded from 157.44) doubled previewed as 314 and saved as 315, and
 *     the gap grows with the factor.
 *   - Meal cards summed rounded per-entry values while the day header summed raw
 *     and rounded once, so the meals never added up to the day.
 *
 * Both are the same mistake — rounding early — and both are fixed by giving the
 * client the same raw inputs and the same function the server uses, so the two
 * agree by construction rather than by two implementations staying in step.
 */

const PER_100G = 100;

/** The per-100g macro columns of a food, the raw input to every total. */
export interface Per100gMacros {
  caloriesPer100g: number | null;
  proteinPer100g: number | null;
  carbPer100g: number | null;
  fatPer100g: number | null;
  fiberPer100g: number | null;
}

function scaleValue(per100g: number | null | undefined, quantityG: number): number {
  if (per100g === null || per100g === undefined) return 0;
  return (per100g * quantityG) / PER_100G;
}

function round(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/** Scale a food's per-100g values to a logged quantity in grams. Unrounded. */
export function scaleNutrition(food: Per100gMacros, quantityG: number): NutritionMacroTotals {
  return {
    calories: scaleValue(food.caloriesPer100g, quantityG),
    protein: scaleValue(food.proteinPer100g, quantityG),
    carb: scaleValue(food.carbPer100g, quantityG),
    fat: scaleValue(food.fatPer100g, quantityG),
    fiber: scaleValue(food.fiberPer100g, quantityG),
  };
}

export function emptyTotals(): NutritionMacroTotals {
  return { calories: 0, protein: 0, carb: 0, fat: 0, fiber: 0 };
}

/** Accumulate `n` into `acc`, raw. Round ONCE at the end, never per addend. */
export function addInto(acc: NutritionMacroTotals, n: NutritionMacroTotals): void {
  acc.calories += n.calories;
  acc.protein += n.protein;
  acc.carb += n.carb;
  acc.fat += n.fat;
  acc.fiber += n.fiber;
}

/** Present totals at sensible precision: whole calories, 1-dp macros. */
export function roundMacros(totals: NutritionMacroTotals): NutritionMacroTotals {
  return {
    calories: Math.round(totals.calories),
    protein: round(totals.protein, 1),
    carb: round(totals.carb, 1),
    fat: round(totals.fat, 1),
    fiber: round(totals.fiber, 1),
  };
}

/**
 * Raw-sum a set of (food, quantity) pairs and round once.
 *
 * The single correct way to total a group of entries. Summing each entry's
 * already-rounded total instead is what stopped meal cards reconciling with the
 * day header.
 */
export function totalNutrition(
  rows: readonly { readonly per100g: Per100gMacros; readonly quantityG: number }[],
): NutritionMacroTotals {
  const totals = emptyTotals();
  for (const row of rows) addInto(totals, scaleNutrition(row.per100g, row.quantityG));
  return roundMacros(totals);
}

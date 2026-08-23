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

/**
 * Atwater general factors — the kcal each gram of a macronutrient yields.
 *
 * The single definition in the codebase: `nutritionTargets.ts` imports these
 * rather than declaring its own copy, so a target and a logged total can never
 * be computed against different factors.
 */
export const KCAL_PER_G_PROTEIN = 4;
export const KCAL_PER_G_CARB = 4;
export const KCAL_PER_G_FAT = 9;

/** Macro grams per 100 g of food, plus a rounding allowance. See below. */
const MAX_MACRO_MASS_PER_100G = 101;

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

/**
 * Energy reconstructed from the macros, for a food whose provider published none.
 *
 * A food row can legitimately reach us with no energy value: Open Food Facts
 * admits a product with no energy field whenever its completeness is decent or
 * unknown, and neither the USDA nor the Edamam mapper gates on calories at all.
 * Scaled naively, `null` becomes 0 and the athlete logs a food carrying 50 g of
 * protein, 120 g of carbohydrate and 20 g of fat as **zero calories** — a day
 * header reading 107 kcal beside 51 g protein and 147 g carb, two numbers in the
 * same object that cannot both be true.
 *
 * The macros ARE the energy, so this is reconstruction rather than invention: a
 * printed food label is itself computed from macros with these same factors.
 * Measured against eight real foods (the Nutella fixture in `offClient.test.ts`
 * and seven USDA entries) it lands between −5% and +11% of the stated value,
 * against the −100% it replaces.
 *
 * Fibre is deliberately left out. Providers disagree on whether their
 * `carbohydrate` figure already includes it — USDA's "by difference" does, the
 * EU convention OFF follows does not — so counting it would need a per-provider
 * claim about payloads this codebase has never verified against live responses.
 * That divergence is the residual: it is what pushes the high-fibre foods
 * (banana +11%, almonds +7%) to the top of the error range.
 *
 * Returns null when there is nothing to reconstruct FROM, so a food with no
 * energy and no energy-bearing macro still reports 0 rather than a fabricated
 * number. The stored row is never rewritten — the derivation happens here, at
 * the single point every server and client total already flows through, so the
 * cache keeps the provider's honest `null` and picks up a real value the moment
 * a refresh supplies one.
 */
function derivedCaloriesPer100g(food: Per100gMacros): number | null {
  const { proteinPer100g, carbPer100g, fatPer100g } = food;
  if (proteinPer100g == null && carbPer100g == null && fatPer100g == null) return null;

  const protein = proteinPer100g ?? 0;
  const carb = carbPer100g ?? 0;
  const fat = fatPer100g ?? 0;

  // 100 g of food cannot contain more than 100 g of macronutrients. Each field
  // is clamped individually on import, but nothing checks them against each
  // other, so three separately-plausible values can still describe an
  // impossible food — and this is the one place that would turn that into a
  // confident calorie figure (200/200/200 derives 3400 kcal per 100 g, where
  // pure fat, the densest food there is, reaches 900). Refuse to derive from
  // macros that cannot coexist rather than assert a number physically no food
  // can have; the small tolerance absorbs providers' 1-dp rounding.
  if (protein + carb + fat > MAX_MACRO_MASS_PER_100G) return null;

  return protein * KCAL_PER_G_PROTEIN + carb * KCAL_PER_G_CARB + fat * KCAL_PER_G_FAT;
}

/** Scale a food's per-100g values to a logged quantity in grams. Unrounded. */
export function scaleNutrition(food: Per100gMacros, quantityG: number): NutritionMacroTotals {
  const caloriesPer100g = food.caloriesPer100g ?? derivedCaloriesPer100g(food);
  return {
    calories: scaleValue(caloriesPer100g, quantityG),
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

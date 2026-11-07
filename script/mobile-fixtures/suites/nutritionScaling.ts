/**
 * shared/nutritionScaling.ts: the per-100g scaling rule and the macro totals
 * the food log shows. The Kotlin port must store the same figure the server
 * does (audit M22), so the cases pin derived energy, every rounding tie and
 * the order of the raw sums.
 */
import {
  addInto,
  emptyTotals,
  KCAL_PER_G,
  KCAL_PER_G_CARB,
  KCAL_PER_G_FAT,
  KCAL_PER_G_PROTEIN,
  type Per100gMacros,
  roundMacros,
  scaleNutrition,
  totalNutrition,
} from "@shared/nutritionScaling";
import type { NutritionMacroTotals } from "@shared/schema";

import { suite } from "../types";

const food = (
  caloriesPer100g: number | null,
  proteinPer100g: number | null,
  carbPer100g: number | null,
  fatPer100g: number | null,
  fiberPer100g: number | null,
): Per100gMacros => ({ caloriesPer100g, proteinPer100g, carbPer100g, fatPer100g, fiberPer100g });

const totals = (calories: number, protein: number, carb: number, fat: number, fiber: number): NutritionMacroTotals => ({
  calories,
  protein,
  carb,
  fat,
  fiber,
});

const same = (v: number): NutritionMacroTotals => totals(v, v, v, v, v);

const BANANA = food(89, 1.1, 22.8, 0.3, 2.6);
const PROTEIN_POWDER = food(null, 25, 60, 10, 5);

/** Foods covering every branch of derivedCaloriesPer100g and scaleValue. */
const FOODS: Per100gMacros[] = [
  BANANA,
  food(null, null, null, null, null), // nothing at all
  food(null, 50, 120, 20, 5), // 190 g of macros per 100 g: over the guard, so 0 kcal (not 860)
  food(null, 25, 60, 10, 5), // 95 g: derived, 430 kcal per 100 g
  food(null, 1, 50, 50, null), // macros sum to exactly 101: derived
  food(null, 1.5, 50, 50, null), // 101.5: not derived, 0 kcal
  food(null, 200, 200, 200, null), // impossible food: not derived
  food(null, 0, 0, 100, null), // pure fat: 900 kcal derived
  food(null, 25, null, null, null), // one macro: the others count as 0
  food(null, null, null, 7, null),
  food(0, 10, 20, 5, 1), // an explicit 0 kcal is kept, not derived
  food(null, null, null, null, 2.1), // fibre only: 0 kcal
  food(null, 0.2, 0.4, 100.4, null), // protein + carb + fat is exactly 101: derived
  food(null, 100.4, 0.4, 0.2, null), // the same grams in another order sum to 101.00000000000001: not derived
  food(null, 0.1, 0.2, 100.7, null), // derived; the kcal sum order shows in the last bit (907.5000000000001)
  food(null, -10, 50, 20, null), // negative macro: still derived
  food(-50, -1, -2, -3, -4), // negative per-100g values scale as they are
  food(null, 0, 0, 0, 0), // zero macros derive 0, not null
  food(1e308, 1e308, 0, 0, 1e308), // overflows at large quantities
  food(Number.NaN, Number.NaN, 10, 1, null), // NaN calories are not nullish: kept, not derived
  food(null, Number.NaN, 10, 1, null), // NaN macro: the guard compares false, energy is NaN
  food(Number.POSITIVE_INFINITY, null, null, null, null), // Infinity × 0 g is NaN
  { proteinPer100g: 10, carbPer100g: 30 } as unknown as Per100gMacros, // absent keys behave as null
  {} as unknown as Per100gMacros,
];

const QUANTITIES = [0, -0, 33.3, 100, 118, 250, -50, 0.1, 1e9, 1e308, 5e-324];

const ROUNDING_VALUES = [
  0, -0, 157.5, 157.44, -0.4, 0.05, -0.05, 1.005, 2.675, 0.25, -0.25, 0.35, -0.35, 0.15, 1.45, -1.45, 0.5, -0.5,
  1.5, 2.5, -2.5, 0.49999999999999994, -0.49999999999999994, 0.1 + 0.2, 99.95, 99.94999999999999, 4.35, 8.345,
  123.456, 1e15 + 0.5, 4503599627370495.5, 1e20, -1e300, 1.7976931348623157e308, 5e-324, Number.NaN,
  Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
];

export const nutritionScalingSuites = [
  suite({
    name: "nutritionScaling.KCAL_PER_G",
    description: "The Atwater factors, as separate constants and as the KCAL_PER_G map.",
    run: () => ({ KCAL_PER_G_PROTEIN, KCAL_PER_G_CARB, KCAL_PER_G_FAT, KCAL_PER_G }),
    cases: [null],
  }),
  suite({
    name: "nutritionScaling.emptyTotals",
    description: "All five totals at 0.",
    run: () => emptyTotals(),
    cases: [null],
  }),
  suite({
    name: "nutritionScaling.scaleNutrition",
    description:
      "Per-100g values scaled to grams, unrounded; energy derived from the macros when it is null and they fit in 101 g.",
    run: ({ food: f, quantityG }: { food: Per100gMacros; quantityG: number }) => scaleNutrition(f, quantityG),
    cases: FOODS.flatMap((f) => QUANTITIES.map((quantityG) => ({ food: f, quantityG }))),
  }),
  suite({
    name: "nutritionScaling.roundMacros",
    description: "Whole calories (Math.round) and 1-dp macros (Math.round(x * 10) / 10), ties towards +Infinity.",
    run: (t: NutritionMacroTotals) => roundMacros(t),
    cases: [
      ...ROUNDING_VALUES.map(same),
      totals(157.5, 0.05, -0.05, 1.005, 2.675),
      totals(-0.4, 12.34, 56.78, 9.95, 0.04),
      scaleNutrition(BANANA, 177),
      scaleNutrition(BANANA, 354),
    ],
  }),
  suite({
    name: "nutritionScaling.addInto",
    description: "Raw field-by-field sums of `addends` into a copy of `acc`, in order.",
    // addInto mutates its accumulator; copy it so the case input is written unchanged.
    run: ({ acc, addends }: { acc: NutritionMacroTotals; addends: NutritionMacroTotals[] }) => {
      const out = { ...acc };
      for (const n of addends) addInto(out, n);
      return out;
    },
    cases: [
      { acc: emptyTotals(), addends: [] },
      { acc: totals(1, 2, 3, 4, 5), addends: [] },
      { acc: emptyTotals(), addends: [same(0.1), same(0.2)] },
      { acc: same(0.1), addends: [same(0.2), same(0.3)] },
      { acc: emptyTotals(), addends: Array.from({ length: 10 }, () => same(0.1)) },
      { acc: emptyTotals(), addends: [same(1e16), same(1), same(1)] },
      { acc: emptyTotals(), addends: [same(1), same(1), same(1e16)] },
      { acc: same(-0), addends: [same(-0)] },
      { acc: same(-5.5), addends: [same(2.25), totals(-1, 1, -1, 1, -1)] },
      { acc: same(1e308), addends: [same(1e308)] },
      { acc: same(Number.POSITIVE_INFINITY), addends: [same(Number.NEGATIVE_INFINITY)] },
      { acc: same(Number.NaN), addends: [same(1)] },
      { acc: emptyTotals(), addends: [scaleNutrition(BANANA, 118), scaleNutrition(PROTEIN_POWDER, 33.3)] },
    ],
  }),
  suite({
    name: "nutritionScaling.totalNutrition",
    description: "Rows scaled and summed raw in order, then rounded once with roundMacros.",
    run: (rows: { per100g: Per100gMacros; quantityG: number }[]) => totalNutrition(rows),
    cases: [
      [],
      // Two 0.25 kcal entries: the raw sum rounds to 1, rounding each first would give 0.
      [
        { per100g: food(0.25, null, null, null, null), quantityG: 100 },
        { per100g: food(0.25, null, null, null, null), quantityG: 100 },
      ],
      // M22: a 157.44 kcal entry at double quantity stores 315 (not 2 × 157).
      [{ per100g: food(157.44, 10, 20, 5, 1), quantityG: 200 }],
      [{ per100g: BANANA, quantityG: 177 }],
      [{ per100g: BANANA, quantityG: 354 }],
      [
        { per100g: BANANA, quantityG: 120 },
        { per100g: PROTEIN_POWDER, quantityG: 200 },
      ],
      Array.from({ length: 10 }, () => ({ per100g: food(0.1, 0.15, 0.05, 0.25, 0.35), quantityG: 100 })),
      [
        { per100g: food(1e18, 1e16, 0, 0, 0), quantityG: 100 },
        { per100g: food(1, 1, 0.5, 0, 0), quantityG: 100 },
        { per100g: food(1, 1, 0.5, 0, 0), quantityG: 100 },
      ],
      [
        { per100g: food(1, 1, 0.5, 0, 0), quantityG: 100 },
        { per100g: food(1, 1, 0.5, 0, 0), quantityG: 100 },
        { per100g: food(1e18, 1e16, 0, 0, 0), quantityG: 100 },
      ],
      [
        { per100g: food(null, null, null, null, null), quantityG: 100 },
        { per100g: food(null, 1, 50, 50, null), quantityG: 33.3 },
        { per100g: food(null, 1.5, 50, 50, null), quantityG: 33.3 },
        { per100g: food(null, null, null, null, 2.1), quantityG: 250 },
      ],
      [
        { per100g: BANANA, quantityG: 100 },
        { per100g: BANANA, quantityG: -100 },
      ],
      [
        { per100g: BANANA, quantityG: 0 },
        { per100g: food(-50, -1, -2, -3, -4), quantityG: 1 },
      ],
      [
        { per100g: food(1e308, 0, 0, 0, 0), quantityG: 1e9 },
        { per100g: BANANA, quantityG: 100 },
      ],
    ],
  }),
];

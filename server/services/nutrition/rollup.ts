import {
  type DailySummaryResponse,
  type Food,
  type FoodLogEntry,
  type FoodLogEntryWithNutrition,
  MEAL_TYPES,
  type MealType,
  type NutritionMacroTotals,
} from "@shared/schema";

/**
 * Pure nutrition math. The ONLY place per-100g values are scaled into real
 * totals, so the scaling rule (value * grams / 100) lives in exactly one spot.
 * DB-free and side-effect-free, which is what makes it cheap to test
 * exhaustively (and where most of the module's line coverage comes from).
 */

const PER_100G = 100;

/** A log entry with its joined food row — the shape the storage layer returns. */
export type LogEntryWithFood = FoodLogEntry & { food: Food };

type Per100gFood = Pick<
  Food,
  "caloriesPer100g" | "proteinPer100g" | "carbPer100g" | "fatPer100g" | "fiberPer100g"
>;

function scaleValue(per100g: number | null, quantityG: number): number {
  if (per100g === null || per100g === undefined) return 0;
  return (per100g * quantityG) / PER_100G;
}

function round(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
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

export function emptyTotals(): NutritionMacroTotals {
  return { calories: 0, protein: 0, carb: 0, fat: 0, fiber: 0 };
}

/** Scale a food's per-100g values to a logged quantity in grams. */
export function scaleNutrition(food: Per100gFood, quantityG: number): NutritionMacroTotals {
  return {
    calories: scaleValue(food.caloriesPer100g, quantityG),
    protein: scaleValue(food.proteinPer100g, quantityG),
    carb: scaleValue(food.carbPer100g, quantityG),
    fat: scaleValue(food.fatPer100g, quantityG),
    fiber: scaleValue(food.fiberPer100g, quantityG),
  };
}

function addInto(acc: NutritionMacroTotals, n: NutritionMacroTotals): void {
  acc.calories += n.calories;
  acc.protein += n.protein;
  acc.carb += n.carb;
  acc.fat += n.fat;
  acc.fiber += n.fiber;
}

function emptyMeals(): Record<MealType, FoodLogEntryWithNutrition[]> {
  const meals = {} as Record<MealType, FoodLogEntryWithNutrition[]>;
  for (const m of MEAL_TYPES) meals[m] = [];
  return meals;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Build the daily summary from a day's joined entries: running totals plus the
 * entries bucketed by meal, each carrying its own scaled nutrition. Rows are
 * assumed pre-sorted by `loggedAt`; meal order follows MEAL_TYPES.
 */
export function buildDailySummary(
  logDate: string,
  rows: LogEntryWithFood[],
): DailySummaryResponse {
  const meals = emptyMeals();
  const rawTotals = emptyTotals();

  for (const row of rows) {
    const nutrition = scaleNutrition(row.food, row.quantityG);
    addInto(rawTotals, nutrition);
    const mealType = row.mealType as MealType;
    const entry: FoodLogEntryWithNutrition = {
      id: row.id,
      foodId: row.foodId,
      name: row.food.name,
      brand: row.food.brand,
      loggedAt: toIso(row.loggedAt),
      logDate: row.logDate,
      quantityG: row.quantityG,
      mealType,
      entryMethod: row.entryMethod,
      nutrition: roundMacros(nutrition),
    };
    meals[mealType].push(entry);
  }

  return { logDate, totals: roundMacros(rawTotals), meals };
}

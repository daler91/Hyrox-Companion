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
 * Project a joined entry row into the wire `FoodLogEntryWithNutrition`, scaling
 * its food's per-100g macros to the logged grams. The single source of truth for
 * that projection, shared by the daily summary (Phase 1) and the session-fuelling
 * views (Phase 3) so an entry looks identical wherever it surfaces.
 */
export function toEntryWithNutrition(row: LogEntryWithFood): FoodLogEntryWithNutrition {
  return {
    id: row.id,
    foodId: row.foodId,
    name: row.food.name,
    brand: row.food.brand,
    loggedAt: toIso(row.loggedAt),
    logDate: row.logDate,
    quantityG: row.quantityG,
    mealType: row.mealType as MealType,
    entryMethod: row.entryMethod,
    nutrition: roundMacros(scaleNutrition(row.food, row.quantityG)),
  };
}

/** Raw (unrounded) macro sum over a set of entries — accumulate, then round once. */
export function sumNutrition(rows: LogEntryWithFood[]): NutritionMacroTotals {
  const totals = emptyTotals();
  for (const row of rows) addInto(totals, scaleNutrition(row.food, row.quantityG));
  return totals;
}

/** Scale a food's per-100g micronutrient map to a logged quantity in grams (FR-5.1). */
export function scaleMicros(
  micros: Record<string, number> | null,
  quantityG: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!micros) return out;
  for (const [key, per100g] of Object.entries(micros)) {
    out[key] = (per100g * quantityG) / PER_100G;
  }
  return out;
}

/** Sum scaled micros across a day's entries (raw, unrounded; keys absent everywhere are omitted). */
export function sumMicros(rows: LogEntryWithFood[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(scaleMicros(row.food.micros, row.quantityG))) {
      totals[key] = (totals[key] ?? 0) + value;
    }
  }
  return totals;
}

/**
 * Project a set of entries and their rounded macro total in one pass. Totals are
 * summed raw then rounded once (no accumulated rounding error), matching the daily
 * summary. Backs the pre/post groups of the session-fuelling view (Phase 3).
 */
export function summariseEntries(rows: LogEntryWithFood[]): {
  entries: FoodLogEntryWithNutrition[];
  totals: NutritionMacroTotals;
} {
  const entries: FoodLogEntryWithNutrition[] = [];
  const rawTotals = emptyTotals();
  for (const row of rows) {
    addInto(rawTotals, scaleNutrition(row.food, row.quantityG));
    entries.push(toEntryWithNutrition(row));
  }
  return { entries, totals: roundMacros(rawTotals) };
}

/**
 * Build the daily summary from a day's joined entries: running totals plus the
 * entries bucketed by meal, each carrying its own scaled nutrition. Rows are
 * assumed pre-sorted by `loggedAt`; meal order follows MEAL_TYPES.
 */
export function buildDailySummary(
  logDate: string,
  rows: LogEntryWithFood[],
): Omit<DailySummaryResponse, "effectiveTarget"> {
  const meals = emptyMeals();
  const rawTotals = emptyTotals();

  for (const row of rows) {
    addInto(rawTotals, scaleNutrition(row.food, row.quantityG));
    const entry = toEntryWithNutrition(row);
    meals[entry.mealType].push(entry);
  }

  return { logDate, totals: roundMacros(rawTotals), meals };
}

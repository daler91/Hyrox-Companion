import { addInto, emptyTotals, roundMacros, scaleNutrition } from "@shared/nutritionScaling";
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
 * Pure nutrition math over JOINED log entries — grouping, per-day rollups, meal
 * projections. The scaling rule itself (value * grams / 100) moved to
 * `@shared/nutritionScaling` so the client applies the identical function; it is
 * re-exported below, so this is still the import site for server callers.
 * DB-free and side-effect-free, which is what makes it cheap to test
 * exhaustively (and where most of the module's line coverage comes from).
 */

const PER_100G = 100;

/** A log entry with its joined food row — the shape the storage layer returns. */
export type LogEntryWithFood = FoodLogEntry & { food: Food };

// The scaling rule itself now lives in `@shared/nutritionScaling` so the CLIENT
// can apply it too. It used to be here alone, which left the client scaling
// already-rounded totals and disagreeing with the server (audit M22). Re-exported
// so every existing server call site is unchanged.
export { addInto, emptyTotals, roundMacros, scaleNutrition } from "@shared/nutritionScaling";

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
    per100g: {
      caloriesPer100g: row.food.caloriesPer100g,
      proteinPer100g: row.food.proteinPer100g,
      carbPer100g: row.food.carbPer100g,
      fatPer100g: row.food.fatPer100g,
      fiberPer100g: row.food.fiberPer100g,
    },
  };
}

/** Raw (unrounded) macro sum over a set of entries — accumulate, then round once. */
export function sumNutrition(rows: LogEntryWithFood[]): NutritionMacroTotals {
  const totals = emptyTotals();
  for (const row of rows) addInto(totals, scaleNutrition(row.food, row.quantityG));
  return totals;
}

/** Group joined entries by their user-local `logDate` — the shared per-day bucket
 *  used by the block view and the fuelling range. */
export function groupByLogDate(rows: LogEntryWithFood[]): Map<string, LogEntryWithFood[]> {
  const byDate = new Map<string, LogEntryWithFood[]>();
  for (const row of rows) {
    const bucket = byDate.get(row.logDate);
    if (bucket) bucket.push(row);
    else byDate.set(row.logDate, [row]);
  }
  return byDate;
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
): Omit<DailySummaryResponse, "effectiveTarget" | "mealTargets"> {
  const meals = emptyMeals();
  const rawTotals = emptyTotals();

  for (const row of rows) {
    addInto(rawTotals, scaleNutrition(row.food, row.quantityG));
    const entry = toEntryWithNutrition(row);
    meals[entry.mealType].push(entry);
  }

  return { logDate, totals: roundMacros(rawTotals), meals };
}

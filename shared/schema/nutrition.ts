import { type Food, MEAL_TYPES, type MealType } from "./tables";
import { z } from "./zod";

/**
 * Request/response contracts for the nutrition module (Phase 1 — core logging).
 *
 * Hand-written rather than derived from the table via drizzle-zod because the
 * wire shapes intentionally diverge from the row: the client sends `loggedAt`
 * as an ISO instant and never sets `userId`, `logDate`, or `entryMethod` —
 * those are all derived server-side (the local `logDate` from the user's
 * timezone, `entryMethod` forced to "manual" in Phase 1).
 */

// Accept an ISO calendar date (YYYY-MM-DD). Both the shape and real-date checks
// run so "2026-13-40" is rejected.
const isoDate = z.string().refine(
  (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)),
  { message: "Expected an ISO date (YYYY-MM-DD)" },
);

// Accept any parseable ISO instant (the client sends `new Date().toISOString()`).
const isoDateTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
  message: "Expected an ISO datetime",
});

const mealType = z.enum(MEAL_TYPES);

// Quantities are grams. Cap at a sane upper bound so a fat-fingered entry can't
// poison a day's totals (100 kg of one food in a single entry is never real).
const quantityG = z.number().positive().max(100_000);

export const foodSearchQuerySchema = z.object({
  q: z.string().trim().min(2, "Search needs at least 2 characters").max(100),
});
export type FoodSearchQuery = z.infer<typeof foodSearchQuerySchema>;

export const createFoodLogSchema = z.object({
  foodId: z.string().min(1),
  quantityG,
  mealType,
  // Instant the food was eaten; defaults to "now" on the client. The server
  // derives the local `logDate` from this + the user's timezone.
  loggedAt: isoDateTime,
});
export type CreateFoodLogInput = z.infer<typeof createFoodLogSchema>;

export const updateFoodLogSchema = z
  .object({
    quantityG,
    mealType,
    loggedAt: isoDateTime,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
export type UpdateFoodLogInput = z.infer<typeof updateFoodLogSchema>;

export const addFavoriteSchema = z.object({
  foodId: z.string().min(1),
});
export type AddFavoriteInput = z.infer<typeof addFavoriteSchema>;

export const dailySummaryQuerySchema = z.object({
  // Optional: the server defaults to the user's local "today" when omitted.
  date: isoDate.optional(),
});
export type DailySummaryQuery = z.infer<typeof dailySummaryQuerySchema>;

export const repeatDaySchema = z.object({
  sourceDate: isoDate,
  // When set, copy only that meal; otherwise copy the whole day.
  mealType: mealType.optional(),
  // Where to copy into; the server defaults to the user's local "today".
  targetDate: isoDate.optional(),
});
export type RepeatDayInput = z.infer<typeof repeatDaySchema>;

// ---------------------------------------------------------------------------
// Response shapes — shared so the client and server can't drift apart.
// ---------------------------------------------------------------------------

export interface FoodSearchResponse {
  results: Food[];
  // True when the USDA API was unreachable and only locally-cached foods are
  // shown (NFR-5 graceful degradation).
  apiDegraded: boolean;
}

export interface NutritionMacroTotals {
  calories: number;
  protein: number;
  carb: number;
  fat: number;
  fiber: number;
}

/** A log entry joined to its food, with nutrition already scaled to the grams. */
export interface FoodLogEntryWithNutrition {
  id: string;
  foodId: string;
  name: string;
  brand: string | null;
  loggedAt: string;
  logDate: string;
  quantityG: number;
  mealType: MealType;
  entryMethod: string;
  nutrition: NutritionMacroTotals;
}

export interface DailySummaryResponse {
  logDate: string;
  totals: NutritionMacroTotals;
  meals: Record<MealType, FoodLogEntryWithNutrition[]>;
}

export interface RepeatDayResponse {
  created: number;
  logDate: string;
}

import { type Food, type FoodServing, MEAL_TYPES, type MealType } from "./tables";
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
  // How the entry was created. Phase 2 distinguishes barcode logging; 'nl'/'photo'
  // arrive in Phase 4. Defaults to 'manual' server-side when omitted.
  entryMethod: z.enum(["manual", "barcode"]).optional(),
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
// Phase 2 (Coverage) — barcode, custom foods, recipes, named servings.
// ---------------------------------------------------------------------------

// A barcode is 8–14 digits (EAN-8 / EAN-13 / UPC-A / UPC-E / GTIN-14).
export const barcodeLookupSchema = z.object({
  code: z.string().regex(/^\d{8,14}$/, "Expected an 8–14 digit barcode"),
});
export type BarcodeLookupInput = z.infer<typeof barcodeLookupSchema>;

// An optional, non-negative per-100g macro for a user-entered custom food.
const macro = (max: number) => z.number().nonnegative().max(max).nullable().optional();

const customFoodFields = {
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(200).nullable().optional(),
  caloriesPer100g: macro(1000),
  proteinPer100g: macro(200),
  carbPer100g: macro(200),
  fatPer100g: macro(200),
  fiberPer100g: macro(200),
  servingSizeG: z.number().positive().max(100_000).nullable().optional(),
};

export const servingInputSchema = z.object({
  label: z.string().trim().min(1).max(60),
  grams: z.number().positive().max(100_000),
});
export type ServingInput = z.infer<typeof servingInputSchema>;

export const createCustomFoodSchema = z.object({
  ...customFoodFields,
  // Optional named servings created alongside the food (FR-2.4).
  servings: z.array(servingInputSchema).max(20).optional(),
});
export type CreateCustomFoodInput = z.infer<typeof createCustomFoodSchema>;

export const updateCustomFoodSchema = z
  .object(customFoodFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
export type UpdateCustomFoodInput = z.infer<typeof updateCustomFoodSchema>;

export const recipeIngredientInputSchema = z.object({
  foodId: z.string().min(1),
  quantityG: z.number().positive().max(100_000),
});

export const createRecipeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  servings: z.number().positive().max(1000),
  ingredients: z.array(recipeIngredientInputSchema).min(1).max(50),
});
export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;

// Editing replaces the whole recipe (name + servings + ingredient list).
export const updateRecipeSchema = createRecipeSchema;
export type UpdateRecipeInput = CreateRecipeInput;

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

/** A food plus its named servings, returned when opening the log dialog (FR-2.4). */
export interface FoodWithServingsResponse {
  food: Food;
  servings: FoodServing[];
}

export interface RecipeIngredientView {
  id: string;
  foodId: string;
  name: string;
  brand: string | null;
  quantityG: number;
  position: number;
  nutrition: NutritionMacroTotals;
}

export interface RecipeWithIngredients {
  id: string;
  name: string;
  servings: number;
  /** The backing custom food (source='custom') that makes the recipe loggable. */
  foodId: string;
  totalGrams: number;
  perServing: NutritionMacroTotals;
  ingredients: RecipeIngredientView[];
}

export interface RecipeListItem {
  id: string;
  name: string;
  servings: number;
  foodId: string;
}

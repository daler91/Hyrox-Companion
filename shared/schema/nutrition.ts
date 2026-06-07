import { type Food, FOOD_ENTRY_METHODS, type FoodServing, MEAL_TYPES, type MealType, type NutritionTarget } from "./tables";
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
  // How the entry was created. 'manual'/'barcode' (Phase 1–2); 'nl'/'photo' (Phase 4,
  // via the batch endpoint). Defaults to 'manual' server-side when omitted.
  entryMethod: z.enum(FOOD_ENTRY_METHODS).optional(),
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

// ---------------------------------------------------------------------------
// Phase 3 (Integration) — relate fuelling to training.
// ---------------------------------------------------------------------------

// Block view range. `to` defaults to the user's local "today" server-side.
export const blockViewQuerySchema = z.object({
  from: isoDate,
  to: isoDate.optional(),
});
export type BlockViewQuery = z.infer<typeof blockViewQuerySchema>;

/** FR-3.1/3.2/3.4 — a session's surrounding entries, split pre/post with totals. */
export interface SessionFuellingResponse {
  workoutId: string;
  date: string;
  // true → split by the workout's real start-time windows; false → by pre/post_workout tags.
  usedStartTime: boolean;
  pre: FoodLogEntryWithNutrition[];
  post: FoodLogEntryWithNutrition[];
  preTotals: NutritionMacroTotals;
  postTotals: NutritionMacroTotals;
}

/** FR-3.3 — one day on the block view: daily intake macros + training UTSS. */
export interface BlockViewPoint {
  date: string;
  calories: number;
  protein: number;
  carb: number;
  fat: number;
  fiber: number;
  utss: number;
}

export interface BlockViewResponse {
  from: string;
  to: string;
  points: BlockViewPoint[];
}

// ---------------------------------------------------------------------------
// Phase 4 (Natural-language logging) — describe a meal → AI items → review → log.
// ---------------------------------------------------------------------------

// A free-text meal description ("2 eggs and a slice of toast"). Capped like the
// workout text parser so a pasted essay can't blow the AI budget.
export const parseMealTextSchema = z.object({
  text: z.string().trim().min(1).max(2000),
});
export type ParseMealTextInput = z.infer<typeof parseMealTextSchema>;

/**
 * One AI-parsed food from a meal description. The model estimates `quantityG`
 * directly (its strength) plus a human-readable `displayAmount`. The server
 * resolves `name` to a visible `Food` (local cache only at parse time); when
 * resolved, `food` + `nutrition` (scaled preview) are populated, otherwise
 * `foodId` is null and the client must pick a match before logging.
 */
export interface ParsedFoodItem {
  name: string;
  quantityG: number;
  displayAmount: string;
  mealType: MealType | null;
  confidence: number;
  foodId: string | null;
  food: Food | null;
  nutrition: NutritionMacroTotals | null;
}

export interface ParseMealResponse {
  items: ParsedFoodItem[];
  warnings: string[];
  // Echoed back so the client can persist it as provenance on the logged entries.
  rawInput: string;
}

// Confirm step: persist the reviewed items in one transaction. `entryMethod`
// records how they were captured; `rawInput` is the original description.
export const createFoodLogBatchSchema = z.object({
  entryMethod: z.enum(["nl", "photo"]),
  rawInput: z.string().max(4000).optional(),
  loggedAt: isoDateTime,
  items: z
    .array(
      z.object({
        foodId: z.string().min(1),
        quantityG,
        mealType,
        // 0–100, as emitted by the parser; stored for provenance/analytics.
        parseConfidence: z.number().min(0).max(100).optional(),
      }),
    )
    .min(1)
    .max(50),
});
export type CreateFoodLogBatchInput = z.infer<typeof createFoodLogBatchSchema>;

export interface BatchLogResponse {
  created: number;
  logDate: string;
}

// ---------------------------------------------------------------------------
// Phase 5 (Insights & Coaching) — targets, micronutrients, AI insights.
// ---------------------------------------------------------------------------

// A non-negative goal (kcal or grams); each is optional so a user can set only
// the goals they care about. Cap matches the per-entry quantity guard.
const targetValue = z.number().nonnegative().max(100_000).nullable().optional();

// Set/replace the user's macro & calorie targets. Targets are versioned by
// effectiveFrom (insert-only, never updated in place) so history is preserved.
export const upsertNutritionTargetSchema = z
  .object({
    calories: targetValue,
    proteinG: targetValue,
    carbG: targetValue,
    fatG: targetValue,
    // Day the target takes effect; server defaults to the user's local today.
    effectiveFrom: isoDate.optional(),
  })
  .refine((v) => [v.calories, v.proteinG, v.carbG, v.fatG].some((x) => x != null), {
    message: "Set at least one target",
  });
export type UpsertNutritionTargetInput = z.infer<typeof upsertNutritionTargetSchema>;

export interface NutritionTargetsResponse {
  // The target effective for the requested day (latest effectiveFrom <= day), or null.
  current: NutritionTarget | null;
  // All target versions, newest effectiveFrom first.
  history: NutritionTarget[];
}

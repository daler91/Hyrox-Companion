import type { EnergyBalanceSummary } from "../energyBalance";
import type { MealFuelTargets } from "../mealFuelling";
import type { SessionFuellingTarget } from "../sessionFuellingTargets";
import { type Food, FOOD_ENTRY_METHODS, type FoodServing, MEAL_TYPES, type MealType, type NutritionTarget } from "./tables";
import { z } from "./zod";

export type { EnergyBalanceSummary } from "../energyBalance";
export type { MealFuelTarget, MealFuelTargets, MealRole, WorkoutTiming } from "../mealFuelling";
export type { SessionFuellingTarget } from "../sessionFuellingTargets";

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

// Sane per-100g ceilings, shared by custom-food validation and the external-food
// import sanity guard (server/services/nutrition/sanitize.ts) so user-entered and
// cached foods obey one rulebook — a real food never exceeds these per 100g.
export const CALORIES_PER_100G_MAX = 1000;
export const MACRO_PER_100G_MAX = 200;
export const SERVING_SIZE_G_MAX = 100_000;

// An optional, non-negative per-100g macro for a user-entered custom food.
const macro = (max: number) => z.number().nonnegative().max(max).nullable().optional();

const customFoodFields = {
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(200).nullable().optional(),
  caloriesPer100g: macro(CALORIES_PER_100G_MAX),
  proteinPer100g: macro(MACRO_PER_100G_MAX),
  carbPer100g: macro(MACRO_PER_100G_MAX),
  fatPer100g: macro(MACRO_PER_100G_MAX),
  fiberPer100g: macro(MACRO_PER_100G_MAX),
  servingSizeG: z.number().positive().max(SERVING_SIZE_G_MAX).nullable().optional(),
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

/** The target in force for a given day, after any training-load periodisation. */
export interface EffectiveTargetSummary {
  calories: number | null;
  proteinG: number | null;
  carbG: number | null;
  fatG: number | null;
  // Signed carb grams applied vs the baseline (0 = flat). The total of the three
  // components below.
  carbDeltaG: number;
  // Breakdown of carbDeltaG so the UI can explain the "why":
  //  • baseLoad — today's training load; • recovery — PAST hard days;
  //  • preload — FUTURE big sessions / race week.
  baseLoadDeltaG: number;
  recoveryDeltaG: number;
  preloadDeltaG: number;
  // Signed protein grams applied vs the baseline (recovery bump; 0 otherwise).
  proteinDeltaG: number;
  // The day's actual training load (UTSS) used for the scaling.
  utss: number;
  // True when carbs/calories were load-scaled (false ⇒ a flat baseline target).
  scaled: boolean;
  // Transparency: machine-readable drivers + a one-line human explanation.
  reasonCodes: string[];
  explanation: string;
  // Plan phase that informed the adjustment, when known (taper/race_week/…).
  phase: "early" | "build" | "peak" | "taper" | "race_week" | null;
}

export interface DailySummaryResponse {
  logDate: string;
  totals: NutritionMacroTotals;
  meals: Record<MealType, FoodLogEntryWithNutrition[]>;
  // The day's effective target (baseline ± load periodisation), or null when the
  // user has set no target. Lets the client render per-date progress correctly.
  effectiveTarget: EffectiveTargetSummary | null;
  // Per-meal fuel targets: the day's effective target distributed across meals,
  // with the morning session's pre/post anchors placed first. Null when no daily
  // target is set; only active meal slots are present. See shared/mealFuelling.ts.
  mealTargets: MealFuelTargets | null;
  // Phase 4 — the day's energy in vs out (measured training calories when a
  // device provided them, else the static TDEE estimate). Optional + nullable:
  // null when the profile lacks BMR inputs (bodyweight/height/age).
  energy?: EnergyBalanceSummary | null;
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

/** Phase 3 — how far the logged fuelling is from the session target (target −
 *  logged). Positive = still to go; negative = already over. */
export interface SessionFuellingGap {
  preCarbG: number;
  postCarbG: number;
  postProteinG: number;
}

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
  /** Phase 3 — recommended fuelling for this session (guidance), or null when unavailable. */
  target?: SessionFuellingTarget | null;
  /** Phase 3 — remaining vs the target, or null when there's no target. */
  gap?: SessionFuellingGap | null;
}

/**
 * System-computed duration/effort estimate for a PLANNED session, used to prefill the
 * fuelling panel. Deterministic (distance-aware) base, personalized from the athlete's
 * logged run pace, and lightly refined by AI — all grounded so values never go extreme.
 * The client still lets the athlete override; these are the seed, not a prescription.
 */
export interface PlannedSessionEstimateResponse {
  planDayId: string;
  /** Estimated session length (minutes), or null when there's nothing to estimate from. */
  durationMin: number | null;
  /** Estimated intensity (RPE 1–10), or null when unknown. */
  rpe: number | null;
  /** Short human rationale when AI refined the estimate, else null. */
  rationale: string | null;
  /** Where the duration came from, for UI transparency. */
  source: "structure" | "sets" | "none";
  /** true when AI adjusted the deterministic+personalized value (vs pure heuristic). */
  refined: boolean;
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
  // Roadmap G — per-day outcome fields for the fuelling↔performance correlation
  // card. Optional so the pure block builder (and its fixtures) stay unchanged;
  // the /block route always decorates them (null where the day has no data).
  carbTargetG?: number | null;
  avgRpe?: number | null;
  compliancePct?: number | null;
}

export interface BlockViewResponse {
  from: string;
  to: string;
  points: BlockViewPoint[];
}

// ---------------------------------------------------------------------------
// Phase 2 (Timeline integration) — per-day fuelling progress for the home screen.
// ---------------------------------------------------------------------------

/**
 * One day's fuelling for the Timeline chip: intake totals, the load-adjusted
 * effective target (null when no target is set), and whether a post-workout meal
 * was logged. Computed for every day in the requested range (zero totals / null
 * target on days with no data).
 */
export interface FuellingDayPoint {
  date: string;
  totals: NutritionMacroTotals;
  effectiveTarget: EffectiveTargetSummary | null;
  hasPostWorkoutFuel: boolean;
}

export interface FuellingRangeResponse {
  from: string;
  to: string;
  days: FuellingDayPoint[];
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
// Phase 4b (Label scan) — photograph a nutrition facts label → AI transcribes
// the exact printed values → review in the custom-food form → save (+ log).
// ---------------------------------------------------------------------------

/** One printed column of a nutrition facts panel. null = not printed. */
export interface LabelMacroSet {
  calories: number | null;
  protein: number | null;
  carb: number | null;
  fat: number | null;
  fiber: number | null;
}

/**
 * What the vision model transcribed off the label — values exactly as printed
 * (calories already in kcal; the server converts kJ before building this).
 * `basis` records which column(s) the label actually shows.
 */
export interface ExtractedNutritionLabel {
  productName: string | null;
  brand: string | null;
  // The serving as printed ("2 biscuits (30g)") and its gram weight if stated.
  servingSizeText: string | null;
  servingSizeG: number | null;
  per100g: LabelMacroSet | null;
  perServing: LabelMacroSet | null;
  basis: "per100g" | "perServing" | "both";
  confidence: number;
}

/**
 * Per-100g prefill for the custom-food form (CreateCustomFoodInput-shaped).
 * Macros are null when they can't be derived — e.g. a per-serving-only label
 * with no gram weight, where assuming 100 g would silently corrupt the food.
 */
export interface LabelFoodSuggestion {
  name: string | null;
  brand: string | null;
  caloriesPer100g: number | null;
  proteinPer100g: number | null;
  carbPer100g: number | null;
  fatPer100g: number | null;
  fiberPer100g: number | null;
  servingSizeG: number | null;
}

export interface ParseLabelResponse {
  // null = the image contained no readable nutrition label.
  label: ExtractedNutritionLabel | null;
  suggestion: LabelFoodSuggestion | null;
  // Normalization caveats to surface in the review UI ("converted from kJ",
  // "derived from per-serving values", ...).
  warnings: string[];
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
    // Training-day-aware periodisation (FR-5.x): when enabled, the effective
    // carb/calorie target for a date is scaled from this baseline by that date's
    // training load (UTSS). Optional so a flat target omits them.
    periodizationEnabled: z.boolean().optional(),
    referenceUtss: z.number().nonnegative().max(1000).nullable().optional(),
    carbGramsPerUtss: z.number().nonnegative().max(100).nullable().optional(),
    // Window-aware periodisation knobs (past recovery + future pre-load + phase).
    // All optional; omitted ⇒ that behaviour stays off (single-day target).
    recoveryEnabled: z.boolean().optional(),
    recoveryProteinBumpFrac: z.number().nonnegative().max(1).nullable().optional(),
    preloadCarbGramsPerUtss: z.number().nonnegative().max(100).nullable().optional(),
    preloadDaysAhead: z.number().int().min(1).max(7).nullable().optional(),
    phaseAware: z.boolean().optional(),
    maxCarbDeltaG: z.number().nonnegative().max(1000).nullable().optional(),
    // Day the target takes effect; server defaults to the user's local today.
    effectiveFrom: isoDate.optional(),
  })
  .refine((v) => [v.calories, v.proteinG, v.carbG, v.fatG].some((x) => x != null), {
    message: "Set at least one target",
  });
export type UpsertNutritionTargetInput = z.infer<typeof upsertNutritionTargetSchema>;

// Set/replace a single meal's target OVERRIDE (per-meal fuelling fine-tune).
// Versioned by effectiveFrom like the daily target; any value left null falls
// back to the engine-computed number for that meal.
export const upsertMealTargetSchema = z
  .object({
    mealType,
    calories: targetValue,
    proteinG: targetValue,
    carbG: targetValue,
    fatG: targetValue,
    // Day the override takes effect; server defaults to the user's local today.
    effectiveFrom: isoDate.optional(),
  })
  .refine((v) => [v.calories, v.proteinG, v.carbG, v.fatG].some((x) => x != null), {
    message: "Set at least one value",
  });
export type UpsertMealTargetInput = z.infer<typeof upsertMealTargetSchema>;

export interface NutritionTargetsResponse {
  // The target effective for the requested day (latest effectiveFrom <= day), or null.
  current: NutritionTarget | null;
  // All target versions, newest effectiveFrom first.
  history: NutritionTarget[];
}

/** Micronutrient unit — micros are stored per-100g in milligrams or micrograms. */
export type MicroUnit = "mg" | "mcg";

/**
 * Display metadata for one curated micronutrient (FR-5.1): canonical key, label,
 * unit, and FDA Reference Daily Intake. Shared so the client can render %RDI bars
 * (e.g. the Log Food dialog's nutrient panel) from the same source of truth the
 * server uses — the server's `MicroDef` extends this with importer-only fields.
 */
export interface MicroDisplayDef {
  key: string;
  label: string;
  unit: MicroUnit;
  rdi: number; // FDA Daily Value, in `unit`
}

/**
 * The curated micros, in display order. Mirrors the server's `MICRO_DEFS`
 * (key/label/unit/rdi); kept here so client and server can't drift on the
 * canonical set, labels, or reference intakes.
 */
export const MICRO_DISPLAY_DEFS: readonly MicroDisplayDef[] = [
  { key: "sodium", label: "Sodium", unit: "mg", rdi: 2300 },
  { key: "potassium", label: "Potassium", unit: "mg", rdi: 4700 },
  { key: "calcium", label: "Calcium", unit: "mg", rdi: 1300 },
  { key: "iron", label: "Iron", unit: "mg", rdi: 18 },
  { key: "magnesium", label: "Magnesium", unit: "mg", rdi: 420 },
  { key: "zinc", label: "Zinc", unit: "mg", rdi: 11 },
  { key: "vitaminC", label: "Vitamin C", unit: "mg", rdi: 90 },
  { key: "vitaminA", label: "Vitamin A", unit: "mcg", rdi: 900 },
  { key: "vitaminD", label: "Vitamin D", unit: "mcg", rdi: 20 },
  { key: "vitaminE", label: "Vitamin E", unit: "mg", rdi: 15 },
  { key: "vitaminK", label: "Vitamin K", unit: "mcg", rdi: 120 },
  { key: "vitaminB6", label: "Vitamin B6", unit: "mg", rdi: 1.7 },
  { key: "vitaminB12", label: "Vitamin B12", unit: "mcg", rdi: 2.4 },
  { key: "folate", label: "Folate", unit: "mcg", rdi: 400 },
];

/** FR-5.1 — one micronutrient's daily total against its reference daily intake. */
export interface MicroSummaryRow {
  key: string;
  label: string;
  unit: MicroUnit;
  amount: number;
  rdi: number;
  pctRdi: number;
}

export interface MicroSummaryResponse {
  date: string;
  // Only micros the day's foods carry data for; absent ≠ zero (most cached foods
  // have no micros until re-fetched from the importer).
  micros: MicroSummaryRow[];
}

/** FR-5.3 — stored AI nutrition insights (Markdown), or null if never generated. */
export interface NutritionInsightsResponse {
  insights: string | null;
  generatedAt?: string;
  // true when a meal has been logged since the analysis was generated.
  stale?: boolean;
}

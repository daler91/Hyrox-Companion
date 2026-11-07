import type { OpenAPIRegistry, ResponseConfig, RouteConfig } from "@asteasolutions/zod-to-openapi";
import { createSelectSchema } from "drizzle-zod";

import { NUTRITION_RANGE_MAX_DAYS } from "../nutritionRange";
import {
  addFavoriteSchema,
  barcodeLookupSchema,
  blockViewQuerySchema,
  createCustomFoodSchema,
  createFoodLogBatchSchema,
  createFoodLogSchema,
  createRecipeSchema,
  dailySummaryQuerySchema,
  FOOD_ENTRY_METHODS,
  FOOD_SOURCES,
  foodLogEntries,
  foods,
  foodSearchQuerySchema,
  foodServings,
  MEAL_TYPES,
  mealTargets,
  nutritionTargets,
  parseExercisesFromImageRequestSchema,
  parseMealTextSchema,
  repeatDaySchema,
  servingInputSchema,
  updateCustomFoodSchema,
  updateFoodLogSchema,
  updateRecipeSchema,
  upsertMealTargetSchema,
  upsertNutritionTargetSchema,
} from "../schema";
import { z } from "../schema/zod";
import type { OpenApiCommon } from "./common";

/**
 * Nutrition and fuelling (server/routes/nutrition/*): food search and custom
 * foods, favourites, logging, the day and range read models, targets, the
 * AI-backed parsers and insights, and recipes.
 *
 * The whole surface sits behind the NUTRITION_ENABLED flag, mounted ahead of
 * authentication (server/routes/nutrition/index.ts), so every operation can
 * answer 404 even when signed in. The AI routes (/parse/*, POST /insights) also
 * run aiConsentCheck and aiBudgetCheck before validation.
 */

const DISABLED = 'nutrition is disabled on this server (NUTRITION_ENABLED is not "true")';
const AI_GATE =
  "Needs AI consent (aiCoachEnabled) and AI budget; nothing reaches the AI provider when either check fails.";
const IMAGE_INVALID = "Unsupported type, over 10 MB, or the bytes are not the declared image type";

/** A local calendar day, YYYY-MM-DD: a Postgres `date`, or a day derived in the athlete's timezone. */
const calendarDate = () => z.string().openapi({ format: "date", example: "2026-03-29" });

/**
 * A component registerCommonComponents registers, by name: OpenApiCommon exposes
 * response helpers, not the schemas, and a oneOf or a 201 needs the schema itself.
 */
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const json = (schema: z.ZodType) => ({ "application/json": { schema } });

function respond(status: number, description: string, schema: z.ZodType): Record<number, ResponseConfig> {
  return { [status]: { description, content: json(schema) } };
}

/** A shape of plain number fields. */
function numbers<K extends string>(...keys: K[]): Record<K, z.ZodNumber> {
  return Object.fromEntries(keys.map((key) => [key, z.number()])) as Record<K, z.ZodNumber>;
}

/** A shape of `number | null` fields (nullable `real` columns, unprinted label values, ...). */
function nullableNumbers<K extends string>(...keys: K[]): Record<K, z.ZodNullable<z.ZodNumber>> {
  return Object.fromEntries(keys.map((key) => [key, z.number().nullable()])) as Record<K, z.ZodNullable<z.ZodNumber>>;
}

const PER_100G = ["caloriesPer100g", "proteinPer100g", "carbPer100g", "fatPer100g", "fiberPer100g"] as const;
const MACRO_KEYS = ["calories", "protein", "carb", "fat", "fiber"] as const;
const TARGET_KEYS = ["calories", "proteinG", "carbG", "fatG"] as const;

/** Reused response shapes. Named only when used more than once (or many times inside one response). */
function registerNutritionComponents(registry: OpenAPIRegistry) {
  const MealType = registry.register(
    "NutritionMealType",
    z.enum(MEAL_TYPES).openapi({ description: "The meal slot a food log entry is filed under" }),
  );

  const MacroTotals = registry.register(
    "NutritionMacroTotals",
    z
      .object(numbers(...MACRO_KEYS))
      .openapi({ description: "Calories in kcal (rounded to a whole number); macros in grams (1 dp)" }),
  );

  // drizzle-zod gives `real` columns a bogus ±8388607 range and `jsonb` an
  // any-JSON union, so those columns are restated.
  const foodRow = createSelectSchema(foods).extend({
    source: z.enum(FOOD_SOURCES).openapi({
      description: "Where the data came from; `custom` is an athlete's own food or a recipe's backing food",
    }),
    sourceId: z.string().nullable().openapi({ description: "The provider's id (USDA fdcId, barcode, ...); null for custom foods" }),
    servingSizeG: z.number().nullable().openapi({ description: 'Typical serving in grams, for a one-tap "1 serving"' }),
    ...nullableNumbers(...PER_100G),
    micros: z.record(z.string(), z.number()).nullable().openapi({
      description:
        "Micronutrients per 100 g keyed by nutrient (sodium, iron, vitaminC, ...), in mg or mcg as GET /micros lists them; null when the source has none",
    }),
    createdByUserId: z.string().nullable().openapi({
      description:
        "Owner of a custom food; null for provider foods. Search, recent foods and food detail also null it on another athlete's public food.",
    }),
    isPublic: z.boolean().openapi({ description: "A custom food its owner shared with everyone" }),
  });

  const Food = registry.register(
    "NutritionFood",
    foodRow.openapi({ description: "A food. Every nutrition value is per 100 g; scale by the logged grams." }),
  );

  const FoodWithPortionMemory = registry.register(
    "NutritionFoodWithPortionMemory",
    foodRow
      .extend({
        lastQuantityG: z.number().nullable().openapi({ description: "Grams last logged; null if never logged" }),
        lastMealType: MealType.nullable().openapi({ description: "Meal last logged in; null if never logged" }),
      })
      .openapi({ description: "A food plus the portion and meal the athlete last logged it in" }),
  );

  const FoodServing = registry.register(
    "NutritionFoodServing",
    createSelectSchema(foodServings)
      .extend({
        grams: z.number(),
        createdByUserId: z.string().nullable().openapi({
          description: "The athlete, on their personal serving; null on a shared one (a USDA portion or a custom food's seed serving)",
        }),
      })
      .openapi({ description: 'A named portion of a food ("1 cup" = 240 g)' }),
  );

  const LogEntry = registry.register(
    "NutritionLogEntry",
    createSelectSchema(foodLogEntries)
      .extend({
        loggedAt: z.string().datetime().openapi({ description: "When the food was eaten" }),
        logDate: calendarDate().openapi({ description: "loggedAt's day in the athlete's timezone, set by the server" }),
        quantityG: z.number(),
        mealType: MealType,
        entryMethod: z.enum(FOOD_ENTRY_METHODS),
        parseConfidence: z.number().nullable().openapi({ description: "0-100, on entries confirmed from an AI parse" }),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
      })
      .openapi({ description: "A stored food log entry" }),
  );

  const LogEntryWithNutrition = registry.register(
    "NutritionLogEntryWithNutrition",
    z
      .object({
        id: z.string(),
        foodId: z.string(),
        name: z.string(),
        brand: z.string().nullable(),
        loggedAt: z.string().datetime(),
        logDate: calendarDate(),
        quantityG: z.number(),
        mealType: MealType,
        entryMethod: z.enum(FOOD_ENTRY_METHODS),
        nutrition: MacroTotals,
        per100g: z
          .object(nullableNumbers(...PER_100G))
          .openapi({ description: "The food's per-100 g values, to rescale without compounding the rounding in `nutrition`" }),
      })
      .openapi({ description: "A log entry joined to its food, with `nutrition` scaled to the logged grams" }),
  );

  const EffectiveTarget = registry.register(
    "NutritionEffectiveTarget",
    z
      .object({
        ...nullableNumbers(...TARGET_KEYS),
        carbDeltaG: z.number().openapi({ description: "Signed carb grams vs the baseline (0 = flat): the sum of the next three" }),
        baseLoadDeltaG: z.number().openapi({ description: "From the day's own training load" }),
        recoveryDeltaG: z.number().openapi({ description: "From recent hard days" }),
        preloadDeltaG: z.number().openapi({ description: "From upcoming big sessions or race week" }),
        proteinDeltaG: z.number().openapi({ description: "Signed protein grams vs the baseline (recovery bump)" }),
        utss: z.number().openapi({ description: "The day's training load used for scaling; 0 without periodisation" }),
        scaled: z.boolean().openapi({ description: "False for a flat baseline target" }),
        reasonCodes: z.array(z.string()),
        explanation: z.string(),
        phase: z.enum(["early", "build", "peak", "taper", "race_week"]).nullable(),
      })
      .openapi({ description: "The target in force for one day, after training-load periodisation" }),
  );

  const macroValues = numbers(...TARGET_KEYS);
  const MealFuelTarget = registry.register(
    "NutritionMealFuelTarget",
    z
      .object({
        ...macroValues,
        role: z.enum(["pre_workout_fast_carbs", "post_workout_recovery", "standard", "flex_remainder"]),
        reasonCodes: z.array(z.string()),
        rationale: z.string(),
        override: z
          .object(nullableNumbers(...TARGET_KEYS))
          .optional()
          .openapi({ description: "Overridden meals only: the stored override (a null field follows the computed split)" }),
        suggested: z
          .object(macroValues)
          .optional()
          .openapi({ description: "Overridden meals only: the computed split the override replaced" }),
      })
      .openapi({ description: "One meal's share of the day's effective target" }),
  );

  const NutritionTarget = registry.register(
    "NutritionTarget",
    createSelectSchema(nutritionTargets)
      .extend({
        ...nullableNumbers(...TARGET_KEYS, "referenceUtss", "carbGramsPerUtss", "recoveryProteinBumpFrac"),
        ...nullableNumbers("preloadCarbGramsPerUtss", "maxCarbDeltaG"),
        preloadDaysAhead: z.number().int().nullable(),
        effectiveFrom: calendarDate().openapi({ description: "First day this version applies to" }),
      })
      .openapi({ description: "One version of the athlete's daily macro and calorie target" }),
  );

  const Recipe = registry.register(
    "NutritionRecipe",
    z
      .object({
        id: z.string(),
        name: z.string(),
        servings: z.number(),
        foodId: z.string().openapi({ description: "The recipe's backing custom food: log this id to log the recipe" }),
        totalGrams: z.number(),
        perServing: MacroTotals,
        ingredients: z.array(
          z.object({
            id: z.string(),
            foodId: z.string(),
            name: z.string(),
            brand: z.string().nullable(),
            quantityG: z.number(),
            position: z.number().int(),
            nutrition: MacroTotals,
          }),
        ),
      })
      .openapi({ description: "A recipe with its ingredients and per-serving macros" }),
  );

  const ParseMealResponse = registry.register(
    "NutritionParseMealResponse",
    z
      .object({
        items: z.array(
          z.object({
            name: z.string(),
            quantityG: z.number().openapi({ description: "The model's estimate, in grams" }),
            displayAmount: z.string().openapi({ example: "2 large eggs" }),
            mealType: MealType.nullable(),
            confidence: z.number().openapi({ description: "0-100" }),
            foodId: z.string().nullable().openapi({ description: "The matched food; null when the athlete must pick one" }),
            food: Food.nullable(),
            nutrition: MacroTotals.nullable().openapi({ description: "Preview scaled to quantityG; null when unmatched" }),
          }),
        ),
        warnings: z.array(z.string()),
        rawInput: z.string().openapi({ description: 'The text parsed ("[photo]" for a photo), for POST /logs/batch `rawInput`' }),
      })
      .openapi({ description: "Suggested food items from an AI meal parse. Nothing is logged." }),
  );

  const LabelMacroSet = registry.register(
    "NutritionLabelMacroSet",
    z
      .object(nullableNumbers(...MACRO_KEYS))
      .openapi({ description: "One printed column of a nutrition label, in kcal and grams; null = not printed" }),
  );

  // The route's limiter and aiBudgetCheck both answer 429 on an AI route; the
  // budget refusal adds its spend and limit to the error envelope.
  const AiRateLimitResponse = registry.register(
    "NutritionAiRateLimitResponse",
    z
      .object({
        error: z.string(),
        code: z.enum(["RATE_LIMITED", "AI_BUDGET_EXCEEDED"]),
        currentCostCents: z.number().int().optional().openapi({ description: "AI_BUDGET_EXCEEDED only: AI spend over the last 24 h" }),
        limitCents: z.number().int().optional().openapi({ description: "AI_BUDGET_EXCEEDED only: the rolling 24 h limit" }),
      })
      .openapi({ description: "A 429 from an AI route: its rate limit, or the athlete's AI budget" }),
  );

  return {
    MealType, MacroTotals, Food, FoodWithPortionMemory, FoodServing, LogEntry, LogEntryWithNutrition,
    EffectiveTarget, MealFuelTarget, NutritionTarget, Recipe, ParseMealResponse, LabelMacroSet, AiRateLimitResponse,
  };
}

type Components = ReturnType<typeof registerNutritionComponents>;
type OperationConfig = Omit<RouteConfig, "method" | "path" | "summary" | "tags" | "security">;

/** Per-module helpers every path group uses. */
function nutritionContext(registry: OpenAPIRegistry, common: OpenApiCommon, c: Components) {
  const op = (method: RouteConfig["method"], path: string, summary: string, config: OperationConfig): void => {
    registry.registerPath({ method, path, summary, tags: ["Nutrition"], security: common.security, ...config });
  };
  /** The feature-flag 404 plus 401/426/429. A route's own 404, spread after, replaces the flag's. */
  const gated = (): Record<number, ResponseConfig> => ({
    ...common.error(404, `NOT_FOUND: ${DISABLED}`),
    ...common.authenticatedResponses(),
  });
  const notFound = (what: string) => common.error(404, `NOT_FOUND: ${what}, or ${DISABLED}`);
  const conflict = (what: string) => common.error(409, `CONFLICT: ${what}`);
  const created = (description: string): Record<number, ResponseConfig> => ({
    201: { description, content: { "application/json": { schema: ref("SuccessResponse") } } },
  });
  const aiBudgetHeaders = {
    "X-AI-Budget-Warning": {
      description: 'Set to "true" once the athlete has used most of their rolling 24 h AI budget',
      schema: { type: "string" as const, enum: ["true"] },
    },
    "X-AI-Budget-Remaining-Cents": {
      description: "Sent with X-AI-Budget-Warning: cents left in the rolling 24 h budget",
      schema: { type: "integer" as const },
    },
  };
  /** A 200 from an AI route, which may carry the budget-warning headers. */
  const aiOk = (description: string, schema: z.ZodType): Record<number, ResponseConfig> => ({
    200: { description, headers: aiBudgetHeaders, content: json(schema) },
  });
  /** aiConsentCheck, aiBudgetCheck and the provider failure, on top of gated(). */
  const aiGated = (): Record<number, ResponseConfig> => ({
    ...gated(),
    ...common.error(403, "AI_COACH_DISABLED: AI coaching is off for this account; enable it in Settings first"),
    ...respond(
      429,
      "RATE_LIMITED (Retry-After says when to try again), or AI_BUDGET_EXCEEDED: the athlete's rolling 24 h AI budget is spent",
      c.AiRateLimitResponse,
    ),
    ...common.error(502, "AI_ERROR or EXTERNAL_API_ERROR: the AI provider failed or returned an unusable response"),
    ...common.error(
      503,
      "AI_FEATURES_DISABLED (AI is off on this server), AI_GLOBAL_BUDGET_EXCEEDED (the app-wide daily AI ceiling is reached) or AI_BUDGET_UNAVAILABLE (the budget check failed)",
    ),
  });
  return { common, c, op, gated, notFound, conflict, created, aiOk, aiGated };
}

type Ctx = ReturnType<typeof nutritionContext>;

function registerFoodPaths({ common, c, op, gated, notFound, conflict }: Ctx): void {
  op("get", "/api/v1/nutrition/foods/search", "Search foods", {
    description:
      "Searches the local food cache (the athlete's own and public custom foods included) and, when that is thin, the live providers (Edamam, USDA, Open Food Facts), caching what they return. At most 30 results, best match first. A provider outage degrades to cached results with `apiDegraded: true`.",
    request: { query: foodSearchQuerySchema },
    responses: {
      ...respond(200, "Matching foods", z.object({
        results: z.array(c.Food),
        apiDegraded: z.boolean().openapi({ description: "No live provider could be reached; only cached foods are shown" }),
      })),
      ...common.validationError("`q` is missing, or shorter than 2 or longer than 100 characters"),
      ...gated(),
    },
  });

  op("get", "/api/v1/nutrition/foods/recent", "List recently logged foods", {
    description: "Up to 20 distinct foods from the athlete's log: most often logged in the last 30 days first, then most recent.",
    responses: { ...respond(200, "Recent foods with their last portion", z.array(c.FoodWithPortionMemory)), ...gated() },
  });

  op("get", "/api/v1/nutrition/foods/custom", "List the athlete's custom foods", {
    description: "The athlete's own custom foods by name, without recipes' backing foods (GET /recipes lists those).",
    responses: { ...respond(200, "Custom foods", z.array(c.Food)), ...gated() },
  });

  op("post", "/api/v1/nutrition/foods/barcode", "Look up a food by barcode", {
    description: "Resolves an EAN/UPC barcode from the cache, then Edamam, then Open Food Facts, caching the food. Logs nothing.",
    request: { body: { content: json(barcodeLookupSchema) } },
    responses: {
      ...respond(200, "The food for the barcode", c.Food),
      ...common.validationError("Not an 8-14 digit barcode"),
      ...gated(),
      ...notFound("Barcode not recognized"),
    },
  });

  op("post", "/api/v1/nutrition/foods", "Create a custom food", {
    description:
      "Creates a private custom food; `servings` become its named portions. The response is the food alone (GET /foods/{id} adds the servings).",
    request: { body: { content: json(createCustomFoodSchema) } },
    responses: { ...respond(201, "The created food", c.Food), ...common.validationError(), ...gated() },
  });

  const params = z.object({ id: z.string().openapi({ description: "Food id" }) });

  op("get", "/api/v1/nutrition/foods/{id}", "Get a food with its servings", {
    description:
      "A food the athlete can see, with its shared servings and the athlete's own. The first open of a USDA food may backfill its portions and micronutrients from USDA.",
    request: { params },
    responses: {
      ...respond(200, "The food and its servings", z.object({ food: c.Food, servings: z.array(c.FoodServing) })),
      ...gated(),
      ...notFound("Food not found or not visible to the athlete"),
    },
  });

  op("patch", "/api/v1/nutrition/foods/{id}", "Edit a custom food", {
    description:
      "Edits one of the athlete's own custom foods (a recipe's backing food is edited through the recipe). `isPublic: true` shares it with everyone. Once another athlete has logged or used it, its name and nutrition are frozen; serving size and sharing can still change.",
    request: { params, body: { content: json(updateCustomFoodSchema) } },
    responses: {
      ...respond(200, "The updated food", c.Food),
      ...common.validationError(),
      ...gated(),
      ...notFound("Not one of the athlete's custom foods"),
      ...conflict("another athlete has logged or used this food, so its name and nutrition cannot change"),
    },
  });

  op("delete", "/api/v1/nutrition/foods/{id}", "Delete a custom food", {
    request: { params },
    responses: {
      ...common.success("Deleted"),
      ...gated(),
      ...notFound("Not one of the athlete's custom foods"),
      ...conflict("a log entry or recipe uses the food, or it is a recipe's backing food (delete the recipe)"),
    },
  });

  op("post", "/api/v1/nutrition/foods/{id}/servings", "Add a named serving to a food", {
    description:
      "Adds a personal serving, seen only by the athlete, to any food they can see. Repeating a label (case-insensitive) on the same food returns the existing serving.",
    request: { params, body: { content: json(servingInputSchema) } },
    responses: {
      ...respond(201, "The serving (new, or the existing one with that label)", c.FoodServing),
      ...common.validationError(),
      ...gated(),
      ...notFound("Food not found or not visible to the athlete"),
    },
  });

  op("delete", "/api/v1/nutrition/foods/{id}/servings/{servingId}", "Delete a named serving", {
    description:
      "Deletes the athlete's personal serving, or any serving on a food they own. The serving is found by `servingId` alone; shared USDA portions cannot be deleted.",
    request: {
      params: z.object({
        id: z.string().openapi({ description: "Food id (not checked against the serving)" }),
        servingId: z.string(),
      }),
    },
    responses: {
      ...common.success("Deleted"),
      ...gated(),
      ...notFound("Serving not found, or not the athlete's to delete"),
    },
  });
}

function registerFavoriteAndLogPaths({ common, c, op, gated, notFound, created }: Ctx): void {
  op("get", "/api/v1/nutrition/favorites", "List favourite foods", {
    description: "Newest first, each with the portion it was last logged in (null if never logged).",
    responses: { ...respond(200, "Favourite foods", z.array(c.FoodWithPortionMemory)), ...gated() },
  });

  op("post", "/api/v1/nutrition/favorites", "Favourite a food", {
    description: "Idempotent: favouriting a food twice keeps one favourite.",
    request: { body: { content: json(addFavoriteSchema) } },
    responses: {
      ...created("Favourited"),
      ...common.validationError(),
      ...gated(),
      ...notFound("Food not found or not visible to the athlete"),
    },
  });

  op("delete", "/api/v1/nutrition/favorites/{foodId}", "Unfavourite a food", {
    request: { params: z.object({ foodId: z.string() }) },
    responses: { ...common.success("Removed"), ...gated(), ...notFound("Favorite not found") },
  });

  const params = z.object({ id: z.string().openapi({ description: "Log entry id" }) });

  op("post", "/api/v1/nutrition/logs", "Log a food", {
    description:
      "The server files the entry under `loggedAt`'s day in the athlete's timezone; a client never sends the day. `entryMethod` defaults to `manual`.",
    request: { body: { content: json(createFoodLogSchema) } },
    responses: {
      ...respond(201, "The created log entry", c.LogEntry),
      ...common.validationError(),
      ...gated(),
      ...notFound("Food not found or not visible to the athlete"),
    },
  });

  op("patch", "/api/v1/nutrition/logs/{id}", "Edit a log entry", {
    description: "A new `loggedAt` also moves the entry to that instant's local day.",
    request: { params, body: { content: json(updateFoodLogSchema) } },
    responses: {
      ...respond(200, "The updated log entry", c.LogEntry),
      ...common.validationError(),
      ...gated(),
      ...notFound("Log entry not found"),
    },
  });

  op("delete", "/api/v1/nutrition/logs/{id}", "Delete a log entry", {
    request: { params },
    responses: { ...common.success("Deleted"), ...gated(), ...notFound("Log entry not found") },
  });

  const LogsCreated = z.object({
    created: z.number().int().openapi({ description: "Entries created" }),
    logDate: calendarDate().openapi({ description: "The local day they were filed under" }),
  });

  op("post", "/api/v1/nutrition/logs/repeat", "Repeat a day or meal", {
    description:
      "Copies `sourceDate`'s entries (only `mealType`'s, when set) onto `targetDate`, default the athlete's local today. Copies onto today are stamped now; onto another day, at 12:00 UTC of that day.",
    request: { body: { content: json(repeatDaySchema) } },
    responses: {
      ...respond(201, "The entries were copied", LogsCreated),
      ...common.validationError(),
      ...gated(),
      ...notFound("No entries found to repeat for that day"),
    },
  });

  op("post", "/api/v1/nutrition/logs/batch", "Log reviewed parsed items", {
    description:
      "The confirm step after POST /parse/text or /parse/photo: logs the reviewed items in one write, all at `loggedAt`. Not AI-gated. Every food must be visible to the athlete, or nothing is logged.",
    request: { body: { content: json(createFoodLogBatchSchema) } },
    responses: {
      ...respond(201, "The items were logged", LogsCreated),
      ...common.validationError(),
      ...gated(),
      ...notFound("A food was not found or is not visible to the athlete (nothing was logged)"),
    },
  });
}

function registerDayAndRangePaths({ common, c, op, gated, notFound }: Ctx): void {
  const mealsOf = <T extends z.ZodType>(schema: T) =>
    Object.fromEntries(MEAL_TYPES.map((meal) => [meal, schema])) as Record<(typeof MEAL_TYPES)[number], T>;

  op("get", "/api/v1/nutrition/summary", "Get a day's nutrition summary", {
    description:
      "The day's totals, entries by meal, effective target, per-meal fuel targets and energy balance. `date` defaults to the athlete's local today.",
    request: { query: dailySummaryQuerySchema },
    responses: {
      ...respond(200, "The day's summary", z.object({
        logDate: calendarDate(),
        totals: c.MacroTotals,
        meals: z
          .object(mealsOf(z.array(c.LogEntryWithNutrition)))
          .openapi({ description: "Every meal slot, each with its entries in loggedAt order (empty when none)" }),
        effectiveTarget: c.EffectiveTarget.nullable().openapi({ description: "Null when the athlete has set no target" }),
        mealTargets: z
          .object(mealsOf(c.MealFuelTarget.optional()))
          .nullable()
          .openapi({ description: "The effective target split across the day's active meal slots (only those are present); null without a target" }),
        energy: z
          .object({
            inKcal: z.number(),
            outKcal: z.number(),
            balanceKcal: z.number().openapi({ description: "in - out: positive is a surplus" }),
            bmrKcal: z.number(),
            activeKcal: z.number().openapi({ description: "Training calories above daily living" }),
            basis: z.enum(["measured", "estimated"]).openapi({ description: "measured: device workout calories were used" }),
            reasonCodes: z.array(z.string()),
            explanation: z.string(),
          })
          .nullable()
          .openapi({ description: "Energy in vs out; null when the profile lacks bodyweight, height or age" }),
      })),
      ...common.validationError("`date` is not a real YYYY-MM-DD day"),
      ...gated(),
    },
  });

  const range = `\`to\` defaults to the athlete's local today. The range is inclusive, at most ${NUTRITION_RANGE_MAX_DAYS} days, within 1900-01-01..2100-12-31.`;
  const rangeInvalid = common.validationError("A date is not a real YYYY-MM-DD day, or the range breaks its limits");

  op("get", "/api/v1/nutrition/summary-range", "Get daily fuelling progress for a range", {
    description: `One point per day: intake totals, the effective target (resolved as GET /summary resolves it) and whether a post-workout meal was logged. ${range}`,
    request: { query: blockViewQuerySchema },
    responses: {
      ...respond(200, "Every day in the range, ascending", z.object({
        from: calendarDate(),
        to: calendarDate(),
        days: z.array(
          z.object({
            date: calendarDate(),
            totals: c.MacroTotals,
            effectiveTarget: c.EffectiveTarget.nullable(),
            hasPostWorkoutFuel: z.boolean(),
          }),
        ),
      })),
      ...rangeInvalid,
      ...gated(),
    },
  });

  op("get", "/api/v1/nutrition/block", "Get intake vs training load for a range", {
    description: `One point per day: intake macros, training load (UTSS), and the day's load-scaled carb target, mean session RPE and compliance. ${range}`,
    request: { query: blockViewQuerySchema },
    responses: {
      ...respond(200, "Every day in the range, ascending", z.object({
        from: calendarDate(),
        to: calendarDate(),
        points: z.array(
          z.object({
            date: calendarDate(),
            ...numbers(...MACRO_KEYS, "utss"),
            carbTargetG: z.number().nullable().openapi({ description: "Null without a target" }),
            avgRpe: z.number().nullable().openapi({ description: "Null when no workout that day has an RPE" }),
            compliancePct: z.number().nullable().openapi({ description: "Null when no workout that day has a compliance" }),
          }),
        ),
      })),
      ...rangeInvalid,
      ...gated(),
    },
  });

  op("get", "/api/v1/nutrition/session-fuelling/{workoutId}", "Get a workout's fuelling", {
    description:
      "The entries before and after a logged workout with their totals, the recommended session fuelling, and the gap. With a device start time the split is by time (4 h before, 6 h after, plus the day's pre/post_workout entries); otherwise by the day's pre_workout/post_workout entries.",
    request: { params: z.object({ workoutId: z.string() }) },
    responses: {
      ...respond(200, "The workout's fuelling", z.object({
        workoutId: z.string(),
        date: calendarDate(),
        usedStartTime: z.boolean().openapi({ description: "true: split by the workout's start time; false: by meal tags" }),
        pre: z.array(c.LogEntryWithNutrition),
        post: z.array(c.LogEntryWithNutrition),
        preTotals: c.MacroTotals,
        postTotals: c.MacroTotals,
        target: z
          .object({ ...numbers("preCarbG", "postCarbG", "postProteinG"), reasonCodes: z.array(z.string()), explanation: z.string() })
          .openapi({ description: "Recommended fuelling for this session" }),
        gap: z
          .object(numbers("preCarbG", "postCarbG", "postProteinG"))
          .openapi({ description: "target - logged: positive is still to go, negative is over" }),
      })),
      ...gated(),
      ...notFound("Workout not found"),
    },
  });

  op("get", "/api/v1/nutrition/planned-session-estimate/{planDayId}", "Estimate a planned session's duration and effort", {
    description:
      "Seeds the fuelling panel for a session not yet done. Not AI-gated: the estimate is deterministic, refined by AI only when the athlete's AI consent and budget allow.",
    request: { params: z.object({ planDayId: z.string() }) },
    responses: {
      ...respond(200, "The estimate", z.object({
        planDayId: z.string(),
        durationMin: z.number().nullable().openapi({ description: "Null when there is nothing to estimate from" }),
        rpe: z.number().nullable().openapi({ description: "RPE 1-10; null when unknown" }),
        rationale: z.string().nullable().openapi({ description: "Set when AI refined the estimate" }),
        source: z.enum(["structure", "sets", "structure_and_sets", "none"]),
        refined: z.boolean().openapi({ description: "AI adjusted the estimate" }),
      })),
      ...gated(),
      ...notFound("Plan day not found"),
    },
  });
}

function registerTargetPaths({ common, c, op, gated, notFound }: Ctx): void {
  op("get", "/api/v1/nutrition/targets", "Get the athlete's targets", {
    responses: {
      ...respond(200, "The current target and every version", z.object({
        current: c.NutritionTarget.nullable().openapi({ description: "The version in force today; null when none is set" }),
        history: z.array(c.NutritionTarget).openapi({ description: "All versions, newest effectiveFrom first" }),
      })),
      ...gated(),
    },
  });

  op("post", "/api/v1/nutrition/targets", "Set a target version", {
    description:
      "Targets are versioned by `effectiveFrom` (default: the athlete's local today); saving a day that already has a version replaces it.",
    request: { body: { content: json(upsertNutritionTargetSchema) } },
    responses: { ...respond(201, "The saved version", c.NutritionTarget), ...common.validationError(), ...gated() },
  });

  op("post", "/api/v1/nutrition/meal-targets", "Set a meal's target override", {
    description:
      "Pins some of one meal's figures over the computed split, versioned by `effectiveFrom` (default: the athlete's local today). A null field follows the computed split.",
    request: { body: { content: json(upsertMealTargetSchema) } },
    responses: {
      ...respond(201, "The saved override", createSelectSchema(mealTargets).extend({
        mealType: c.MealType,
        ...nullableNumbers(...TARGET_KEYS),
        effectiveFrom: calendarDate(),
      })),
      ...common.validationError(),
      ...gated(),
    },
  });

  op("delete", "/api/v1/nutrition/meal-targets/{mealType}", "Clear a meal's target overrides", {
    description: "Removes every version of the meal's override; also succeeds when there was none.",
    request: { params: z.object({ mealType: c.MealType }) },
    responses: { ...common.success("Cleared"), ...gated(), ...notFound("Unknown meal") },
  });

  op("get", "/api/v1/nutrition/micros", "Get a day's micronutrients", {
    description: "The day's micronutrient totals against reference daily intakes. `date` defaults to the athlete's local today.",
    request: { query: dailySummaryQuerySchema },
    responses: {
      ...respond(200, "The day's micronutrients", z.object({
        date: calendarDate(),
        micros: z
          .array(
            z.object({
              key: z.string().openapi({ example: "iron" }),
              label: z.string().openapi({ example: "Iron" }),
              unit: z.enum(["mg", "mcg"]),
              amount: z.number(),
              rdi: z.number().openapi({ description: "Reference daily intake, in `unit`" }),
              pctRdi: z.number().int(),
            }),
          )
          .openapi({ description: "Only micros the day's foods carry data for; a missing micro is unknown, not zero" }),
      })),
      ...common.validationError("`date` is not a real YYYY-MM-DD day"),
      ...gated(),
    },
  });
}

function registerAiPaths({ common, c, op, gated, aiOk, aiGated }: Ctx): void {
  op("post", "/api/v1/nutrition/parse/text", "Parse a meal description", {
    description: `Turns free text ("2 eggs and toast") into suggested items matched to cached foods. Nothing is logged; confirm with POST /logs/batch. ${AI_GATE}`,
    request: { body: { content: json(parseMealTextSchema) } },
    responses: { ...aiOk("Suggested items", c.ParseMealResponse), ...common.validationError(), ...aiGated() },
  });

  op("post", "/api/v1/nutrition/parse/photo", "Parse a meal photo", {
    description: `Same contract as POST /parse/text, from a base64 photo of the meal (up to 10 MB). ${AI_GATE}`,
    request: { body: { content: json(parseExercisesFromImageRequestSchema) } },
    responses: {
      ...aiOk("Suggested items", c.ParseMealResponse),
      ...common.validationError(IMAGE_INVALID),
      ...common.error(413, "PAYLOAD_TOO_LARGE: the body is over 10 MB"),
      ...aiGated(),
    },
  });

  const servingsSuggestion = z.array(z.object({ label: z.string(), grams: z.number() }));
  op("post", "/api/v1/nutrition/parse/label", "Read a nutrition label photo", {
    description: `Transcribes a photographed nutrition facts panel into per-100 g values to prefill POST /foods. A photo with no readable label is a 200 with \`label: null\`. Nothing is saved. ${AI_GATE}`,
    request: { body: { content: json(parseExercisesFromImageRequestSchema) } },
    responses: {
      ...aiOk("The transcription and the suggested custom food", z.object({
        label: z
          .object({
            productName: z.string().nullable(),
            brand: z.string().nullable(),
            servingSizeText: z.string().nullable().openapi({ example: "2 biscuits (30g)" }),
            servingSizeG: z.number().nullable(),
            servingsPerContainer: z.number().nullable(),
            per100g: c.LabelMacroSet.nullable(),
            perServing: c.LabelMacroSet.nullable(),
            basis: z.enum(["per100g", "perServing", "both"]).openapi({ description: "The columns the label prints" }),
            confidence: z.number().openapi({ description: "0-100" }),
          })
          .nullable()
          .openapi({ description: "Values as printed (energy converted to kcal); null when no readable label was found" }),
        suggestion: z
          .object({
            name: z.string().nullable(),
            brand: z.string().nullable(),
            ...nullableNumbers(...PER_100G, "servingSizeG"),
            servings: servingsSuggestion,
          })
          .nullable()
          .openapi({
            description:
              "A POST /foods prefill; a macro is null when it cannot be derived (a per-serving label with no gram weight). Null when no label was found.",
          }),
        warnings: z.array(z.string()).openapi({ description: 'Caveats to show in review ("converted from kJ", ...)' }),
      })),
      ...common.validationError(IMAGE_INVALID),
      ...common.error(413, "PAYLOAD_TOO_LARGE: the body is over 10 MB"),
      ...aiGated(),
    },
  });

  op("get", "/api/v1/nutrition/insights", "Get the stored nutrition insights", {
    description: "The last stored AI analysis, without generating one: no AI spend and no consent check.",
    responses: {
      ...respond(200, "The stored analysis, or `insights: null` when none was ever generated", z.object({
        insights: z.string().nullable().openapi({ description: "Markdown; null when never generated" }),
        generatedAt: z.string().datetime().optional().openapi({ description: "Present with insights" }),
        stale: z.boolean().optional().openapi({ description: "Present with insights: true when a meal was logged after the analysis" }),
      })),
      ...gated(),
    },
  });

  op("post", "/api/v1/nutrition/insights", "Regenerate the nutrition insights", {
    description: `Generates a new AI analysis of recent nutrition and stores it. Rate limited to 3 per window. ${AI_GATE}`,
    responses: {
      ...aiOk(
        "The new analysis",
        z.object({ insights: z.string().openapi({ description: "Markdown" }), generatedAt: z.string().datetime(), stale: z.literal(false) }),
      ),
      ...aiGated(),
    },
  });
}

function registerRecipePaths({ common, c, op, gated, notFound, conflict }: Ctx): void {
  const params = z.object({ id: z.string().openapi({ description: "Recipe id" }) });
  // The Zod middleware answers a bad body; the storage layer's ingredient checks
  // throw an AppError, which has the other envelope.
  const badRequest: Record<number, ResponseConfig> = {
    400: {
      description:
        "The body failed validation (ValidationErrorResponse), or an ingredient food is not visible to the athlete or, on PATCH, is the recipe's own food (ErrorResponse, code VALIDATION_ERROR)",
      content: { "application/json": { schema: { oneOf: [ref("ValidationErrorResponse"), ref("ErrorResponse")] } } },
    },
  };

  op("get", "/api/v1/nutrition/recipes", "List recipes", {
    responses: {
      ...respond(200, "The athlete's recipes by name", z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          servings: z.number(),
          foodId: z.string().openapi({ description: "The recipe's backing custom food" }),
        }),
      )),
      ...gated(),
    },
  });

  op("post", "/api/v1/nutrition/recipes", "Create a recipe", {
    description:
      "Creates the recipe and its backing custom food, whose per-100 g values are computed from the ingredients. Log the recipe by its `foodId`.",
    request: { body: { content: json(createRecipeSchema) } },
    responses: { ...respond(201, "The created recipe", c.Recipe), ...badRequest, ...gated() },
  });

  op("get", "/api/v1/nutrition/recipes/{id}", "Get a recipe", {
    request: { params },
    responses: { ...respond(200, "The recipe with its ingredients", c.Recipe), ...gated(), ...notFound("Recipe not found") },
  });

  op("patch", "/api/v1/nutrition/recipes/{id}", "Replace a recipe", {
    description:
      "Replaces the name, servings and whole ingredient list, and recomputes the backing food (and the athlete's recipes that use it).",
    request: { params, body: { content: json(updateRecipeSchema) } },
    responses: {
      ...respond(200, "The updated recipe", c.Recipe),
      ...badRequest,
      ...gated(),
      ...notFound("Recipe not found"),
      ...conflict("other athletes have logged this recipe, so its name and ingredients cannot change"),
    },
  });

  op("delete", "/api/v1/nutrition/recipes/{id}", "Delete a recipe", {
    description: "The backing food is kept while log entries or other recipes still use it.",
    request: { params },
    responses: {
      ...common.success("Deleted"),
      ...gated(),
      ...notFound("Recipe not found"),
      ...conflict("the recipe is an ingredient of another of the athlete's recipes"),
    },
  });
}

export function registerNutritionPaths(registry: OpenAPIRegistry, common: OpenApiCommon): void {
  const ctx = nutritionContext(registry, common, registerNutritionComponents(registry));
  registerFoodPaths(ctx);
  registerFavoriteAndLogPaths(ctx);
  registerDayAndRangePaths(ctx);
  registerTargetPaths(ctx);
  registerAiPaths(ctx);
  registerRecipePaths(ctx);
}

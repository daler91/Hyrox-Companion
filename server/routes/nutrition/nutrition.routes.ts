import {
  type AddFavoriteInput,
  addFavoriteSchema,
  type BarcodeLookupInput,
  barcodeLookupSchema,
  type BatchLogResponse,
  type BlockViewQuery,
  blockViewQuerySchema,
  type BlockViewResponse,
  type CreateCustomFoodInput,
  createCustomFoodSchema,
  type CreateFoodLogBatchInput,
  createFoodLogBatchSchema,
  type CreateFoodLogInput,
  createFoodLogSchema,
  type CreateRecipeInput,
  createRecipeSchema,
  type DailySummaryQuery,
  dailySummaryQuerySchema,
  type DailySummaryResponse,
  type FoodSearchQuery,
  foodSearchQuerySchema,
  type MealType,
  type MicroSummaryResponse,
  type NutritionTargetsResponse,
  type ParseMealResponse,
  type ParseMealTextInput,
  parseMealTextSchema,
  type RepeatDayInput,
  repeatDaySchema,
  type ServingInput,
  servingInputSchema,
  type SessionFuellingResponse,
  type UpdateCustomFoodInput,
  updateCustomFoodSchema,
  type UpdateFoodLogInput,
  updateFoodLogSchema,
  updateRecipeSchema,
  type UpsertNutritionTargetInput,
  upsertNutritionTargetSchema,
} from "@shared/schema";
import { type Request, type Response, Router } from "express";

import { isAuthenticated } from "../../clerkAuth";
import { asyncHandler, rateLimiter, sendNotFound, validateBody, validateQuery } from "../../routeUtils";
import { lookupBarcode } from "../../services/nutrition/barcode";
import { buildBlockView } from "../../services/nutrition/blockView";
import { getFoodWithServings } from "../../services/nutrition/foodDetail";
import { searchFoods } from "../../services/nutrition/foodSearch";
import { parseMealFromText, resolveAndPreview } from "../../services/nutrition/mealParser";
import { buildMicroSummary } from "../../services/nutrition/micros";
import { buildDailySummary } from "../../services/nutrition/rollup";
import {
  computeSessionFuelling,
  POST_WINDOW_MS,
  PRE_WINDOW_MS,
} from "../../services/nutrition/sessionFuelling";
import { calculateTrainingLoad } from "../../services/trainingLoadService";
import { storage } from "../../storage";
import { getLocalDateStr } from "../../timezone";
import { getUserId } from "../../types";
import { protectedDelete, protectedPatch, protectedPost } from "../_helpers/protectedRouteBuilder";

const FOOD_NOT_FOUND = "Food not found";
const LOG_ENTRY_NOT_FOUND = "Log entry not found";
const RECIPE_NOT_FOUND = "Recipe not found";

/** Resolve the user's IANA timezone, defaulting to UTC pre-detection. */
async function getUserTimezone(userId: string): Promise<string> {
  const user = await storage.users.getUser(userId);
  return user?.userTimezone ?? "UTC";
}

export function registerNutritionRoutes(router: Router): void {
  // ---- foods: search / recent / custom -------------------------------------
  // NOTE: the static /foods/* GET routes must be registered BEFORE /foods/:id,
  // or the param route swallows "custom"/"search"/"recent".

  // FR-1.1 — search foods (local cache + own custom foods + USDA, caching misses).
  router.get(
    "/api/v1/nutrition/foods/search",
    isAuthenticated,
    rateLimiter("nutritionSearch", 30),
    validateQuery(foodSearchQuerySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { q } = req.query as unknown as FoodSearchQuery;
      res.json(await searchFoods(q, getUserId(req)));
    }),
  );

  // FR-1.4 — recent foods for one-tap re-logging.
  router.get(
    "/api/v1/nutrition/foods/recent",
    isAuthenticated,
    rateLimiter("nutritionRead", 60),
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await storage.nutrition.getRecentFoods(getUserId(req)));
    }),
  );

  // FR-2.2 — the user's custom foods (excludes recipe-backing foods).
  router.get(
    "/api/v1/nutrition/foods/custom",
    isAuthenticated,
    rateLimiter("nutritionRead", 60),
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await storage.nutrition.listCustomFoods(getUserId(req)));
    }),
  );

  // FR-2.1 — resolve a barcode via Open Food Facts (cache-first), then log it.
  protectedPost(
    router,
    "/api/v1/nutrition/foods/barcode",
    { limiter: rateLimiter("nutritionBarcode", 30), middleware: [validateBody(barcodeLookupSchema)] },
    async (req: Request, res: Response) => {
      const { code } = req.body as BarcodeLookupInput;
      const food = await lookupBarcode(code);
      if (!food) return sendNotFound(res, "Barcode not recognized");
      res.json(food);
    },
  );

  // FR-2.2 — create a custom food (with optional named servings).
  protectedPost(
    router,
    "/api/v1/nutrition/foods",
    { limiter: rateLimiter("nutritionWrite", 30), middleware: [validateBody(createCustomFoodSchema)] },
    async (req: Request, res: Response) => {
      const food = await storage.nutrition.createCustomFood(getUserId(req), req.body as CreateCustomFoodInput);
      res.status(201).json(food);
    },
  );

  // FR-2.4 — a food + its named servings (USDA portions enriched on first access).
  router.get(
    "/api/v1/nutrition/foods/:id",
    isAuthenticated,
    rateLimiter("nutritionRead", 60),
    asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
      const result = await getFoodWithServings(getUserId(req), req.params.id);
      if (!result) return sendNotFound(res, FOOD_NOT_FOUND);
      res.json(result);
    }),
  );

  // FR-2.2 — edit / delete a custom food (owner-scoped; 409 if referenced).
  protectedPatch(
    router,
    "/api/v1/nutrition/foods/:id",
    { limiter: rateLimiter("nutritionWrite", 30), middleware: [validateBody(updateCustomFoodSchema)] },
    async (req: Request<{ id: string }>, res: Response) => {
      const food = await storage.nutrition.updateCustomFood(
        getUserId(req),
        req.params.id,
        req.body as UpdateCustomFoodInput,
      );
      if (!food) return sendNotFound(res, FOOD_NOT_FOUND);
      res.json(food);
    },
  );

  protectedDelete(
    router,
    "/api/v1/nutrition/foods/:id",
    { limiter: rateLimiter("nutritionWrite", 30) },
    async (req: Request<{ id: string }>, res: Response) => {
      // Throws a 409 AppError when the food is referenced by a log entry/recipe.
      const deleted = await storage.nutrition.deleteCustomFood(getUserId(req), req.params.id);
      if (!deleted) return sendNotFound(res, FOOD_NOT_FOUND);
      res.json({ success: true });
    },
  );

  // FR-2.4 — named-serving CRUD for a user's custom food.
  protectedPost(
    router,
    "/api/v1/nutrition/foods/:id/servings",
    { limiter: rateLimiter("nutritionWrite", 30), middleware: [validateBody(servingInputSchema)] },
    async (req: Request<{ id: string }>, res: Response) => {
      const serving = await storage.nutrition.createServing(
        getUserId(req),
        req.params.id,
        req.body as ServingInput,
      );
      if (!serving) return sendNotFound(res, FOOD_NOT_FOUND);
      res.status(201).json(serving);
    },
  );

  protectedDelete(
    router,
    "/api/v1/nutrition/foods/:id/servings/:servingId",
    { limiter: rateLimiter("nutritionWrite", 30) },
    async (req: Request<{ id: string; servingId: string }>, res: Response) => {
      const removed = await storage.nutrition.deleteServing(getUserId(req), req.params.servingId);
      if (!removed) return sendNotFound(res, "Serving not found");
      res.json({ success: true });
    },
  );

  // ---- favorites (FR-1.5) --------------------------------------------------
  router.get(
    "/api/v1/nutrition/favorites",
    isAuthenticated,
    rateLimiter("nutritionRead", 60),
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await storage.nutrition.listFavorites(getUserId(req)));
    }),
  );

  protectedPost(
    router,
    "/api/v1/nutrition/favorites",
    { limiter: rateLimiter("nutritionFav", 30), middleware: [validateBody(addFavoriteSchema)] },
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const { foodId } = req.body as AddFavoriteInput;
      const food = await storage.nutrition.getVisibleFoodById(userId, foodId);
      if (!food) return sendNotFound(res, FOOD_NOT_FOUND);
      await storage.nutrition.addFavorite(userId, foodId);
      res.status(201).json({ success: true });
    },
  );

  protectedDelete(
    router,
    "/api/v1/nutrition/favorites/:foodId",
    { limiter: rateLimiter("nutritionFav", 30) },
    async (req: Request<{ foodId: string }>, res: Response) => {
      const removed = await storage.nutrition.removeFavorite(getUserId(req), req.params.foodId);
      if (!removed) return sendNotFound(res, "Favorite not found");
      res.json({ success: true });
    },
  );

  // ---- logging (FR-1.2 / FR-1.3 / FR-1.6) ----------------------------------
  // FR-1.2 — log a food. The server derives `logDate` from `loggedAt` + the
  // user's timezone; never trust a client-sent date (cross-midnight bug class).
  protectedPost(
    router,
    "/api/v1/nutrition/logs",
    { limiter: rateLimiter("nutritionLog", 60), middleware: [validateBody(createFoodLogSchema)] },
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const body = req.body as CreateFoodLogInput;
      const food = await storage.nutrition.getVisibleFoodById(userId, body.foodId);
      if (!food) return sendNotFound(res, FOOD_NOT_FOUND);

      const loggedAt = new Date(body.loggedAt);
      const logDate = getLocalDateStr(loggedAt, await getUserTimezone(userId));
      const entry = await storage.nutrition.createLogEntry(userId, {
        foodId: body.foodId,
        quantityG: body.quantityG,
        mealType: body.mealType,
        loggedAt,
        logDate,
        entryMethod: body.entryMethod,
      });
      res.status(201).json(entry);
    },
  );

  // FR-1.3 — daily view: running totals + entries bucketed by meal.
  router.get(
    "/api/v1/nutrition/summary",
    isAuthenticated,
    rateLimiter("nutritionRead", 60),
    validateQuery(dailySummaryQuerySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const { date } = req.query as unknown as DailySummaryQuery;
      const logDate = date ?? getLocalDateStr(new Date(), await getUserTimezone(userId));
      const rows = await storage.nutrition.listEntriesWithFoodForDate(userId, logDate);
      const summary: DailySummaryResponse = buildDailySummary(logDate, rows);
      res.json(summary);
    }),
  );

  // ---- Phase 3 (Integration): relate fuelling to training ------------------

  // FR-3.1/3.2/3.4 — a session's surrounding entries, split pre/post. When the
  // workout has a true start instant (from Strava/Garmin) we window by time;
  // otherwise we fall back to that day's pre_workout/post_workout meal tags.
  router.get(
    "/api/v1/nutrition/session-fuelling/:workoutId",
    isAuthenticated,
    rateLimiter("nutritionRead", 60),
    asyncHandler(async (req: Request<{ workoutId: string }>, res: Response) => {
      const userId = getUserId(req);
      // userId-scoped: a foreign workout resolves to undefined → 404 (no leak).
      const workout = await storage.workouts.getWorkoutLog(req.params.workoutId, userId);
      if (!workout) return sendNotFound(res, "Workout not found");

      const entries = workout.startedAt
        ? await storage.nutrition.listEntriesWithFoodInWindow(
            userId,
            new Date(workout.startedAt.getTime() - PRE_WINDOW_MS),
            new Date(workout.startedAt.getTime() + POST_WINDOW_MS),
          )
        : await storage.nutrition.listEntriesWithFoodForDate(userId, workout.date);

      const response: SessionFuellingResponse = {
        workoutId: workout.id,
        date: workout.date,
        ...computeSessionFuelling(workout, entries),
      };
      res.json(response);
    }),
  );

  // FR-3.3 — block view: daily intake macros vs training UTSS over a range.
  // Calls calculateTrainingLoad directly for the FULL range (training-overview's
  // trend is hard-capped at 42 days), reusing the same analytics storage.
  router.get(
    "/api/v1/nutrition/block",
    isAuthenticated,
    rateLimiter("nutritionRead", 60),
    validateQuery(blockViewQuerySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const { from, to: toParam } = req.query as unknown as BlockViewQuery;
      const to = toParam ?? getLocalDateStr(new Date(), await getUserTimezone(userId));

      const [rows, workoutLogs, exerciseSets, loadTags] = await Promise.all([
        storage.nutrition.listEntriesWithFoodForDateRange(userId, from, to),
        storage.analytics.getWorkoutLogsByDateRange(userId, from, to),
        storage.analytics.getAllExerciseSetsWithDates(userId, from, to),
        storage.analytics.getExerciseLoadTags(),
      ]);

      const { dailyLoads } = calculateTrainingLoad(workoutLogs, exerciseSets, loadTags, {
        currentDate: to,
      });
      const response: BlockViewResponse = {
        from,
        to,
        points: buildBlockView(rows, dailyLoads, { from, to }),
      };
      res.json(response);
    }),
  );

  // FR-1.6 — edit a log entry. Recompute logDate if the instant moved.
  protectedPatch(
    router,
    "/api/v1/nutrition/logs/:id",
    { limiter: rateLimiter("nutritionLog", 60), middleware: [validateBody(updateFoodLogSchema)] },
    async (req: Request<{ id: string }>, res: Response) => {
      const userId = getUserId(req);
      const body = req.body as UpdateFoodLogInput;
      const patch: { quantityG?: number; mealType?: MealType; loggedAt?: Date; logDate?: string } = {};
      if (body.quantityG !== undefined) patch.quantityG = body.quantityG;
      if (body.mealType !== undefined) patch.mealType = body.mealType;
      if (body.loggedAt !== undefined) {
        const loggedAt = new Date(body.loggedAt);
        patch.loggedAt = loggedAt;
        patch.logDate = getLocalDateStr(loggedAt, await getUserTimezone(userId));
      }
      const updated = await storage.nutrition.updateLogEntry(userId, req.params.id, patch);
      if (!updated) return sendNotFound(res, LOG_ENTRY_NOT_FOUND);
      res.json(updated);
    },
  );

  // FR-1.6 — delete a log entry.
  protectedDelete(
    router,
    "/api/v1/nutrition/logs/:id",
    { limiter: rateLimiter("nutritionLog", 60) },
    async (req: Request<{ id: string }>, res: Response) => {
      const deleted = await storage.nutrition.deleteLogEntry(getUserId(req), req.params.id);
      if (!deleted) return sendNotFound(res, LOG_ENTRY_NOT_FOUND);
      res.json({ success: true });
    },
  );

  // FR-1.5 — repeat a previous day (or one of its meals) onto a target day.
  protectedPost(
    router,
    "/api/v1/nutrition/logs/repeat",
    { limiter: rateLimiter("nutritionLog", 20), middleware: [validateBody(repeatDaySchema)] },
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const body = req.body as RepeatDayInput;
      const tz = await getUserTimezone(userId);
      const now = new Date();
      const todayStr = getLocalDateStr(now, tz);
      const targetDate = body.targetDate ?? todayStr;
      // Repeating onto today stamps "now"; onto another date, local noon of that
      // date so the entry's instant falls within its logDate for most zones.
      const loggedAt = targetDate === todayStr ? now : new Date(`${targetDate}T12:00:00Z`);
      const created = await storage.nutrition.repeatDay(userId, {
        sourceDate: body.sourceDate,
        mealType: body.mealType,
        targetDate,
        loggedAt,
      });
      if (created === 0) return sendNotFound(res, "No entries found to repeat for that day");
      res.status(201).json({ created, logDate: targetDate });
    },
  );

  // ---- Phase 4 (Natural-language logging) ----------------------------------
  // FR-4.1 — parse a free-text meal description into suggested food items.
  // AI-gated (consent + daily budget) and on the shared "parse" rate bucket.
  // Returns suggestions only; nothing is logged until the client confirms via
  // /logs/batch (never auto-log an AI guess).
  protectedPost(
    router,
    "/api/v1/nutrition/parse/text",
    {
      limiter: rateLimiter("parse", 5),
      aiConsent: true,
      aiBudget: true,
      validation: [validateBody(parseMealTextSchema)],
    },
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const { text } = req.body as ParseMealTextInput;
      const raw = await parseMealFromText(text, userId);
      const { items, warnings } = await resolveAndPreview(raw, userId);
      const response: ParseMealResponse = { items, warnings, rawInput: text };
      res.json(response);
    },
  );

  // FR-4.1 — confirm reviewed items: persist them in one batch. Pure DB write
  // (no AI gate). logDate is derived server-side from the user's timezone.
  protectedPost(
    router,
    "/api/v1/nutrition/logs/batch",
    { limiter: rateLimiter("nutritionLog", 60), validation: [validateBody(createFoodLogBatchSchema)] },
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const body = req.body as CreateFoodLogBatchInput;
      // Every food must be visible to the user (no cross-user / unknown foods).
      const ids = body.items.map((i) => i.foodId);
      const visible = await storage.nutrition.getVisibleFoodsByIds(userId, ids);
      if (ids.some((id) => !visible.has(id))) return sendNotFound(res, FOOD_NOT_FOUND);

      const loggedAt = new Date(body.loggedAt);
      const logDate = getLocalDateStr(loggedAt, await getUserTimezone(userId));
      const created = await storage.nutrition.createLogEntriesBatch(userId, {
        entryMethod: body.entryMethod,
        rawInput: body.rawInput ?? null,
        loggedAt,
        logDate,
        items: body.items.map((i) => ({
          foodId: i.foodId,
          quantityG: i.quantityG,
          mealType: i.mealType,
          parseConfidence: i.parseConfidence ?? null,
        })),
      });
      const response: BatchLogResponse = { created: created.length, logDate };
      res.status(201).json(response);
    },
  );

  // ---- Phase 5 (Insights & Coaching): targets ------------------------------
  // FR-5.2 — the current macro/calorie target (for today) plus version history.
  router.get(
    "/api/v1/nutrition/targets",
    isAuthenticated,
    rateLimiter("nutritionRead", 60),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const today = getLocalDateStr(new Date(), await getUserTimezone(userId));
      const [current, history] = await Promise.all([
        storage.nutrition.getCurrentTarget(userId, today),
        storage.nutrition.listTargets(userId),
      ]);
      const response: NutritionTargetsResponse = { current: current ?? null, history };
      res.json(response);
    }),
  );

  // FR-5.2 — set/replace a target version (defaults effectiveFrom to local today).
  protectedPost(
    router,
    "/api/v1/nutrition/targets",
    { limiter: rateLimiter("nutritionWrite", 30), validation: [validateBody(upsertNutritionTargetSchema)] },
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const body = req.body as UpsertNutritionTargetInput;
      const effectiveFrom = body.effectiveFrom ?? getLocalDateStr(new Date(), await getUserTimezone(userId));
      const target = await storage.nutrition.createTarget(userId, { ...body, effectiveFrom });
      res.status(201).json(target);
    },
  );

  // FR-5.1 — the day's micronutrient totals vs reference daily intakes.
  router.get(
    "/api/v1/nutrition/micros",
    isAuthenticated,
    rateLimiter("nutritionRead", 60),
    validateQuery(dailySummaryQuerySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const { date } = req.query as unknown as DailySummaryQuery;
      const logDate = date ?? getLocalDateStr(new Date(), await getUserTimezone(userId));
      const rows = await storage.nutrition.listEntriesWithFoodForDate(userId, logDate);
      const response: MicroSummaryResponse = { date: logDate, micros: buildMicroSummary(rows) };
      res.json(response);
    }),
  );

  // ---- recipes (FR-2.3) ----------------------------------------------------
  protectedPost(
    router,
    "/api/v1/nutrition/recipes",
    { limiter: rateLimiter("nutritionWrite", 30), middleware: [validateBody(createRecipeSchema)] },
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      // Throws a 400 AppError if an ingredient food isn't visible to the user.
      const recipe = await storage.nutrition.createRecipe(userId, req.body as CreateRecipeInput);
      res.status(201).json(await storage.nutrition.getRecipeWithIngredients(userId, recipe.id));
    },
  );

  router.get(
    "/api/v1/nutrition/recipes",
    isAuthenticated,
    rateLimiter("nutritionRead", 60),
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await storage.nutrition.listRecipes(getUserId(req)));
    }),
  );

  router.get(
    "/api/v1/nutrition/recipes/:id",
    isAuthenticated,
    rateLimiter("nutritionRead", 60),
    asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
      const recipe = await storage.nutrition.getRecipeWithIngredients(getUserId(req), req.params.id);
      if (!recipe) return sendNotFound(res, RECIPE_NOT_FOUND);
      res.json(recipe);
    }),
  );

  protectedPatch(
    router,
    "/api/v1/nutrition/recipes/:id",
    { limiter: rateLimiter("nutritionWrite", 30), middleware: [validateBody(updateRecipeSchema)] },
    async (req: Request<{ id: string }>, res: Response) => {
      const userId = getUserId(req);
      const updated = await storage.nutrition.updateRecipe(userId, req.params.id, req.body as CreateRecipeInput);
      if (!updated) return sendNotFound(res, RECIPE_NOT_FOUND);
      res.json(await storage.nutrition.getRecipeWithIngredients(userId, updated.id));
    },
  );

  protectedDelete(
    router,
    "/api/v1/nutrition/recipes/:id",
    { limiter: rateLimiter("nutritionWrite", 30) },
    async (req: Request<{ id: string }>, res: Response) => {
      const deleted = await storage.nutrition.deleteRecipe(getUserId(req), req.params.id);
      if (!deleted) return sendNotFound(res, RECIPE_NOT_FOUND);
      res.json({ success: true });
    },
  );
}

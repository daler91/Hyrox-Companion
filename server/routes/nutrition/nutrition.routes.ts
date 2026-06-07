import {
  type AddFavoriteInput,
  addFavoriteSchema,
  type CreateFoodLogInput,
  createFoodLogSchema,
  type DailySummaryQuery,
  dailySummaryQuerySchema,
  type DailySummaryResponse,
  type FoodSearchQuery,
  foodSearchQuerySchema,
  type MealType,
  type RepeatDayInput,
  repeatDaySchema,
  type UpdateFoodLogInput,
  updateFoodLogSchema,
} from "@shared/schema";
import { type Request, type Response, Router } from "express";

import { isAuthenticated } from "../../clerkAuth";
import { asyncHandler, rateLimiter, sendNotFound, validateBody, validateQuery } from "../../routeUtils";
import { searchFoods } from "../../services/nutrition/foodSearch";
import { buildDailySummary } from "../../services/nutrition/rollup";
import { storage } from "../../storage";
import { getLocalDateStr } from "../../timezone";
import { getUserId } from "../../types";
import { protectedDelete, protectedPatch, protectedPost } from "../_helpers/protectedRouteBuilder";

const FOOD_NOT_FOUND = "Food not found";
const LOG_ENTRY_NOT_FOUND = "Log entry not found";

/** Resolve the user's IANA timezone, defaulting to UTC pre-detection. */
async function getUserTimezone(userId: string): Promise<string> {
  const user = await storage.users.getUser(userId);
  return user?.userTimezone ?? "UTC";
}

export function registerNutritionRoutes(router: Router): void {
  // FR-1.1 — search foods (local cache + USDA, caching misses).
  router.get(
    "/api/v1/nutrition/foods/search",
    isAuthenticated,
    rateLimiter("nutritionSearch", 30),
    validateQuery(foodSearchQuerySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { q } = req.query as unknown as FoodSearchQuery;
      res.json(await searchFoods(q));
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

  // FR-1.5 — favorites.
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
      const food = await storage.nutrition.getFoodById(foodId);
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

  // FR-1.2 — log a food. The server derives `logDate` from `loggedAt` + the
  // user's timezone; never trust a client-sent date (cross-midnight bug class).
  protectedPost(
    router,
    "/api/v1/nutrition/logs",
    { limiter: rateLimiter("nutritionLog", 60), middleware: [validateBody(createFoodLogSchema)] },
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const body = req.body as CreateFoodLogInput;
      const food = await storage.nutrition.getFoodById(body.foodId);
      if (!food) return sendNotFound(res, FOOD_NOT_FOUND);

      const loggedAt = new Date(body.loggedAt);
      const logDate = getLocalDateStr(loggedAt, await getUserTimezone(userId));
      const entry = await storage.nutrition.createLogEntry(userId, {
        foodId: body.foodId,
        quantityG: body.quantityG,
        mealType: body.mealType,
        loggedAt,
        logDate,
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
}

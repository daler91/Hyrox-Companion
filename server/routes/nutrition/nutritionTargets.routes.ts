import {
  type DailySummaryQuery,
  dailySummaryQuerySchema,
  MEAL_TYPES,
  type MealType,
  type MicroSummaryResponse,
  type NutritionTargetsResponse,
  type UpsertMealTargetInput,
  upsertMealTargetSchema,
  type UpsertNutritionTargetInput,
  upsertNutritionTargetSchema,
} from "@shared/schema";
import { type Request, type Response, Router } from "express";

import { isAuthenticated } from "../../clerkAuth";
import { asyncHandler, rateLimiter, sendNotFound, validateBody, validateQuery } from "../../routeUtils";
import { buildMicroSummary } from "../../services/nutrition/micros";
import { storage } from "../../storage";
import { getLocalDateStr } from "../../timezone";
import { getUserId } from "../../types";
import { protectedDelete, protectedPost } from "../_helpers/protectedRouteBuilder";
import { getUserTimezone } from "./shared";

// Targets (FR-5.2), per-meal target overrides, and the day's micronutrient
// summary (FR-5.1).
export function registerNutritionTargetRoutes(router: Router): void {
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

  // Phase 3 — per-meal target overrides (fine-tune one meal's macros/calories).
  // POST upserts (defaults effectiveFrom to local today); DELETE clears a meal.
  protectedPost(
    router,
    "/api/v1/nutrition/meal-targets",
    { limiter: rateLimiter("nutritionWrite", 30), validation: [validateBody(upsertMealTargetSchema)] },
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const body = req.body as UpsertMealTargetInput;
      const effectiveFrom = body.effectiveFrom ?? getLocalDateStr(new Date(), await getUserTimezone(userId));
      const row = await storage.nutrition.upsertMealTarget(userId, { ...body, effectiveFrom });
      res.status(201).json(row);
    },
  );

  protectedDelete(
    router,
    "/api/v1/nutrition/meal-targets/:mealType",
    { limiter: rateLimiter("nutritionWrite", 30) },
    async (req: Request<{ mealType: string }>, res: Response) => {
      const { mealType } = req.params;
      if (!(MEAL_TYPES as readonly string[]).includes(mealType)) {
        sendNotFound(res, "Unknown meal");
        return;
      }
      await storage.nutrition.deleteMealTarget(getUserId(req), mealType as MealType);
      res.json({ success: true });
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
}

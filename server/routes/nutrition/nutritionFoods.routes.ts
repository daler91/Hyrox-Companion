import {
  type BarcodeLookupInput,
  barcodeLookupSchema,
  type CreateCustomFoodInput,
  createCustomFoodSchema,
  type FoodSearchQuery,
  foodSearchQuerySchema,
  type ServingInput,
  servingInputSchema,
  type UpdateCustomFoodInput,
  updateCustomFoodSchema,
} from "@shared/schema";
import { type Request, type Response, Router } from "express";

import { isAuthenticated } from "../../clerkAuth";
import { asyncHandler, rateLimiter, sendNotFound, validateBody, validateQuery } from "../../routeUtils";
import { lookupBarcode } from "../../services/nutrition/barcode";
import { getFoodWithServings } from "../../services/nutrition/foodDetail";
import { searchFoods } from "../../services/nutrition/foodSearch";
import { storage } from "../../storage";
import { getUserId } from "../../types";
import { protectedDelete, protectedPatch, protectedPost } from "../_helpers/protectedRouteBuilder";
import { FOOD_NOT_FOUND } from "./shared";

const FOOD_BY_ID_PATH = "/api/v1/nutrition/foods/:id";

// Foods: search / recent / custom lists, barcode lookup, custom-food CRUD and
// named servings (FR-1.1, FR-1.4, FR-2.1, FR-2.2, FR-2.4).
export function registerNutritionFoodRoutes(router: Router): void {
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
      if (!food) {
        sendNotFound(res, "Barcode not recognized");
        return;
      }
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
    FOOD_BY_ID_PATH,
    isAuthenticated,
    rateLimiter("nutritionRead", 60),
    asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
      const result = await getFoodWithServings(getUserId(req), req.params.id);
      if (!result) {
        sendNotFound(res, FOOD_NOT_FOUND);
        return;
      }
      res.json(result);
    }),
  );

  // FR-2.2 — edit / delete a custom food (owner-scoped; 409 if referenced).
  protectedPatch(
    router,
    FOOD_BY_ID_PATH,
    { limiter: rateLimiter("nutritionWrite", 30), middleware: [validateBody(updateCustomFoodSchema)] },
    async (req: Request<{ id: string }>, res: Response) => {
      const food = await storage.nutrition.updateCustomFood(
        getUserId(req),
        req.params.id,
        req.body as UpdateCustomFoodInput,
      );
      if (!food) {
        sendNotFound(res, FOOD_NOT_FOUND);
        return;
      }
      res.json(food);
    },
  );

  protectedDelete(
    router,
    FOOD_BY_ID_PATH,
    { limiter: rateLimiter("nutritionWrite", 30) },
    async (req: Request<{ id: string }>, res: Response) => {
      // Throws a 409 AppError when the food is referenced by a log entry/recipe.
      const deleted = await storage.nutrition.deleteCustomFood(getUserId(req), req.params.id);
      if (!deleted) {
        sendNotFound(res, FOOD_NOT_FOUND);
        return;
      }
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
      if (!serving) {
        sendNotFound(res, FOOD_NOT_FOUND);
        return;
      }
      res.status(201).json(serving);
    },
  );

  protectedDelete(
    router,
    "/api/v1/nutrition/foods/:id/servings/:servingId",
    { limiter: rateLimiter("nutritionWrite", 30) },
    async (req: Request<{ id: string; servingId: string }>, res: Response) => {
      const removed = await storage.nutrition.deleteServing(getUserId(req), req.params.servingId);
      if (!removed) {
        sendNotFound(res, "Serving not found");
        return;
      }
      res.json({ success: true });
    },
  );
}

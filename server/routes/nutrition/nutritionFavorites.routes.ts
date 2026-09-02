import { type AddFavoriteInput, addFavoriteSchema } from "@shared/schema";
import { type Request, type Response, Router } from "express";

import { isAuthenticated } from "../../clerkAuth";
import { asyncHandler, rateLimiter, sendNotFound, validateBody } from "../../routeUtils";
import { storage } from "../../storage";
import { getUserId } from "../../types";
import { protectedDelete, protectedPost } from "../_helpers/protectedRouteBuilder";
import { FOOD_NOT_FOUND } from "./shared";

// Favorites (FR-1.5): list / add / remove a user's favorite foods.
export function registerNutritionFavoriteRoutes(router: Router): void {
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
      if (!food) {
        sendNotFound(res, FOOD_NOT_FOUND);
        return;
      }
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
      if (!removed) {
        sendNotFound(res, "Favorite not found");
        return;
      }
      res.json({ success: true });
    },
  );
}

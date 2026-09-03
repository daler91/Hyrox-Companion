import { type CreateRecipeInput, createRecipeSchema, updateRecipeSchema } from "@shared/schema";
import { type Request, type Response, Router } from "express";

import { isAuthenticated } from "../../clerkAuth";
import { asyncHandler, rateLimiter, sendNotFound, validateBody } from "../../routeUtils";
import { storage } from "../../storage";
import { getUserId } from "../../types";
import { protectedDelete, protectedPatch, protectedPost } from "../_helpers/protectedRouteBuilder";
import { RECIPE_NOT_FOUND } from "./shared";

const RECIPE_BY_ID_PATH = "/api/v1/nutrition/recipes/:id";

// Recipes (FR-2.3): CRUD over a user's recipes and their ingredients.
export function registerNutritionRecipeRoutes(router: Router): void {
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
    RECIPE_BY_ID_PATH,
    isAuthenticated,
    rateLimiter("nutritionRead", 60),
    asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
      const recipe = await storage.nutrition.getRecipeWithIngredients(getUserId(req), req.params.id);
      if (!recipe) {
        sendNotFound(res, RECIPE_NOT_FOUND);
        return;
      }
      res.json(recipe);
    }),
  );

  protectedPatch(
    router,
    RECIPE_BY_ID_PATH,
    { limiter: rateLimiter("nutritionWrite", 30), middleware: [validateBody(updateRecipeSchema)] },
    async (req: Request<{ id: string }>, res: Response) => {
      const userId = getUserId(req);
      const updated = await storage.nutrition.updateRecipe(userId, req.params.id, req.body as CreateRecipeInput);
      if (!updated) {
        sendNotFound(res, RECIPE_NOT_FOUND);
        return;
      }
      res.json(await storage.nutrition.getRecipeWithIngredients(userId, updated.id));
    },
  );

  protectedDelete(
    router,
    RECIPE_BY_ID_PATH,
    { limiter: rateLimiter("nutritionWrite", 30) },
    async (req: Request<{ id: string }>, res: Response) => {
      const deleted = await storage.nutrition.deleteRecipe(getUserId(req), req.params.id);
      if (!deleted) {
        sendNotFound(res, RECIPE_NOT_FOUND);
        return;
      }
      res.json({ success: true });
    },
  );
}

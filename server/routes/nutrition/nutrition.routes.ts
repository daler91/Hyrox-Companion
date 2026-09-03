import { Router } from "express";

import { registerNutritionFavoriteRoutes } from "./nutritionFavorites.routes";
import { registerNutritionFoodRoutes } from "./nutritionFoods.routes";
import { registerNutritionInsightRoutes } from "./nutritionInsights.routes";
import { registerNutritionLogRoutes } from "./nutritionLogs.routes";
import { registerNutritionParseRoutes } from "./nutritionParse.routes";
import { registerNutritionRecipeRoutes } from "./nutritionRecipes.routes";
import { registerNutritionSummaryRoutes } from "./nutritionSummary.routes";
import { registerNutritionTargetRoutes } from "./nutritionTargets.routes";

/**
 * Composes the nutrition API (/api/v1/nutrition/*) from one sub-module per
 * endpoint group, following the server/routes/workouts layout. The feature-flag
 * gate is mounted by ./index.ts before this runs, so nothing here needs it.
 *
 * Registration order. Express matches in registration order, so a param route
 * can swallow a static path of the same verb that is registered after it. The
 * only such pair lives INSIDE the foods module (GET /foods/search, /recent and
 * /custom must precede GET /foods/:id) and that module keeps them in order.
 * Across modules every param route (/foods/:id, /favorites/:foodId, /logs/:id,
 * /session-fuelling/:workoutId, /planned-session-estimate/:planDayId,
 * /meal-targets/:mealType, /recipes/:id) has a first path segment that no
 * other module registers, so no module can capture another module's static
 * path whichever order they are registered in. The order below simply follows
 * the original single-file layout. Any new param route that shares a first
 * segment with a static path in another module must be registered after it.
 */
export function registerNutritionRoutes(router: Router): void {
  registerNutritionFoodRoutes(router);
  registerNutritionFavoriteRoutes(router);
  registerNutritionLogRoutes(router);
  registerNutritionSummaryRoutes(router);
  registerNutritionParseRoutes(router);
  registerNutritionTargetRoutes(router);
  registerNutritionInsightRoutes(router);
  registerNutritionRecipeRoutes(router);
}

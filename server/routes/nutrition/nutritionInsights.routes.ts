import { type NutritionInsightsResponse } from "@shared/schema";
import { type Request, type Response, Router } from "express";

import { isAuthenticated } from "../../clerkAuth";
import { asyncHandler, rateLimiter } from "../../routeUtils";
import { getNutritionAnchor, regenerateAndStoreNutritionInsights } from "../../services/analyticsPersistence";
import { getUserId } from "../../types";
import { protectedPost } from "../_helpers/protectedRouteBuilder";
import { readStoredAnalysis } from "../_helpers/storedAnalysis";

// AI nutrition insights (FR-5.3): read the stored analysis, or regenerate it.
export function registerNutritionInsightRoutes(router: Router): void {
  // FR-5.3 — AI nutrition insights. GET returns the last stored analysis instantly
  // (no AI spend) with a `stale` flag set when a meal was logged after it was
  // generated; POST regenerates (AI consent + budget gated) and persists.
  router.get(
    "/api/v1/nutrition/insights",
    isAuthenticated,
    rateLimiter("nutritionRead", 60),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = getUserId(req);
      // The anchor is the food log, not the workouts.
      const stored = await readStoredAnalysis<NutritionInsightsResponse>(userId, "nutrition_insights", getNutritionAnchor);
      const response: NutritionInsightsResponse = stored ?? { insights: null };
      res.json(response);
    }),
  );

  protectedPost(
    router,
    "/api/v1/nutrition/insights",
    { limiter: rateLimiter("suggestions", 3), aiConsent: true, aiBudget: true },
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const result = await regenerateAndStoreNutritionInsights(userId);
      // Freshly generated against the current latest food log, so never stale.
      const response: NutritionInsightsResponse = { ...result, stale: false };
      res.json(response);
    },
  );
}

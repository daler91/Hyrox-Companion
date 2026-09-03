import { type NutritionInsightsResponse } from "@shared/schema";
import { type Request, type Response, Router } from "express";

import { isAuthenticated } from "../../clerkAuth";
import { asyncHandler, rateLimiter } from "../../routeUtils";
import { computeStale, getNutritionAnchor, regenerateAndStoreNutritionInsights } from "../../services/analyticsPersistence";
import { storage } from "../../storage";
import { getUserId } from "../../types";
import { protectedPost } from "../_helpers/protectedRouteBuilder";

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
      // Fetch the stored row and the staleness anchor concurrently — they read
      // unrelated tables (analytics_results vs food_log_entries), so there's no
      // ordering dependency on this "paint instantly on tab open" path. Halves
      // the DB latency for the common case (row exists) at the cost of one
      // harmless unused query when a user has no stored insights yet.
      const [row, anchor] = await Promise.all([
        storage.analyticsResults.get(userId, "nutrition_insights"),
        getNutritionAnchor(userId),
      ]);
      if (!row) {
        const empty: NutritionInsightsResponse = { insights: null };
        res.json(empty);
        return;
      }
      const payload = row.payload as NutritionInsightsResponse;
      const response: NutritionInsightsResponse = {
        ...payload,
        generatedAt: row.generatedAt.toISOString(),
        stale: computeStale(row, anchor),
      };
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

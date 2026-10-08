/**
 * Feature dispatch for the midnight recompute-analytics queue worker.
 * Extracted from server/queue.ts so the routing is unit-testable without
 * pg-boss and exhaustive by construction: the switch covers every
 * AnalyticsFeature and the never-typed default makes a future 5th feature a
 * compile error here instead of a silent mis-dispatch (which is exactly how
 * nutrition_insights jobs used to fall through to coach-insights generation —
 * spending AI twice per night and stamping nutrition as recomputed when it
 * never was).
 */
import type { AnalyticsFeature } from "@shared/schema";
import type { Logger } from "pino";

import {
  getNutritionAnchor,
  getTrainingAnchor,
  getWorkoutAnchor,
  persistCoachInsights,
  persistNutritionInsights,
  persistOverviewAnalysis,
  regenerateAndStoreRacePrediction,
} from "./analyticsPersistence";
import { generateCoachInsightsIfAllowed } from "./coachInsightsService";
import { generateNutritionInsightsIfAllowed } from "./nutrition/nutritionInsightsService";
import { generateOverviewAnalysisIfAllowed } from "./overviewAnalysisService";

/**
 * `recomputedOn` is the local date the midnight run claimed, stamped on the
 * stored row; undefined for an out-of-schedule refresh (a training-style
 * switch, A1), which must not take the nightly claim.
 */
export async function dispatchRecomputeAnalytics(
  feature: AnalyticsFeature,
  userId: string,
  recomputedOn: string | undefined,
  log: Logger,
): Promise<void> {
  switch (feature) {
    case "race_prediction":
      // Always refreshes (deterministic fallback when AI is unavailable).
      await regenerateAndStoreRacePrediction(userId, log, recomputedOn);
      return;
    case "overview_analysis": {
      // Self-gated: leave the prior stored analysis intact when consent/budget
      // block the call (the caller's once-per-day claim stops a same-day retry).
      // The anchor is read before generating for the reason documented on
      // regenerateAndStore (analyticsPersistence.ts). Training logs only, as
      // the analysis reads (PF10).
      const anchor = await getTrainingAnchor(userId);
      const outcome = await generateOverviewAnalysisIfAllowed(userId, log);
      if (outcome.ok) {
        await persistOverviewAnalysis(userId, outcome.result, recomputedOn, anchor);
      } else {
        // reason is a fixed enum, no PII
        // bearer:disable javascript_lang_logger_leak
        log.info({ reason: outcome.reason }, "[pg-boss] Overview analysis recompute skipped (gated)");
      }
      return;
    }
    case "coach_insights": {
      const anchor = await getWorkoutAnchor(userId);
      const outcome = await generateCoachInsightsIfAllowed(userId, log);
      if (outcome.ok) {
        await persistCoachInsights(userId, outcome.result, recomputedOn, anchor);
      } else {
        // reason is a fixed enum, no PII
        // bearer:disable javascript_lang_logger_leak
        log.info({ reason: outcome.reason }, "[pg-boss] Coach insights recompute skipped (gated)");
      }
      return;
    }
    case "nutrition_insights": {
      const anchor = await getNutritionAnchor(userId);
      const outcome = await generateNutritionInsightsIfAllowed(userId, log);
      if (outcome.ok) {
        await persistNutritionInsights(userId, outcome.result, recomputedOn, anchor);
      } else {
        // reason is a fixed enum, no PII
        // bearer:disable javascript_lang_logger_leak
        log.info({ reason: outcome.reason }, "[pg-boss] Nutrition insights recompute skipped (gated)");
      }
      return;
    }
    default: {
      const exhaustive: never = feature;
      // feature is an enum name, no PII
      // bearer:disable javascript_lang_logger_leak
      log.error({ feature: exhaustive }, "[pg-boss] Unknown recompute-analytics feature");
    }
  }
}

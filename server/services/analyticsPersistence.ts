/**
 * "Generate + persist" wrappers for the durable analytics surfaces, so the
 * route handlers and the midnight recompute cron write results through ONE
 * place. Generation snapshots the athlete's latest workout date (the staleness
 * anchor) and upserts the analytics_results row.
 *
 * The `persist*` helpers are split out so the cron — which gates Coach Insights
 * via generateCoachInsightsIfAllowed and must NOT generate a second time — can
 * store an already-generated result without re-running the model.
 */
import type { OverviewAnalysisResult, RacePredictionResponse } from "@shared/schema";
import type { Logger } from "pino";

import { logger as defaultLogger } from "../logger";
import { storage } from "../storage";
import { type CoachInsightsResult, generateCoachInsights } from "./coachInsightsService";
import { generateNutritionInsights, type NutritionInsightsResult } from "./nutrition/nutritionInsightsService";
import { generateOverviewAnalysis } from "./overviewAnalysisService";
import { generateRacePrediction } from "./racePrediction/racePredictionService";

// Re-exported so route handlers can import the staleness check alongside the
// persistence helpers; the canonical (dependency-free) definition lives in
// analyticsStaleness so the recompute scheduler can use it in isolation.
export { computeStale } from "./analyticsStaleness";

/** Latest logged-workout calendar date (YYYY-MM-DD) for the user, or null. */
export async function getLatestWorkoutDate(userId: string): Promise<string | null> {
  const [latest] = await storage.workouts.listWorkoutLogs(userId, 1);
  return latest?.date ?? null;
}

/**
 * Persist an already-generated race prediction as the user's stored result.
 * Pass `recomputedOn` (a local YYYY-MM-DD) only from the cron path so the row
 * records the daily claim; omit it on manual refresh so the cron's once-per-day
 * guard is preserved.
 */
export async function persistRacePrediction(
  userId: string,
  prediction: RacePredictionResponse,
  recomputedOn?: string,
): Promise<void> {
  await storage.analyticsResults.upsert({
    userId,
    feature: "race_prediction",
    payload: prediction,
    generatedAt: new Date(prediction.generatedAt),
    lastWorkoutDateAtGeneration: await getLatestWorkoutDate(userId),
    recomputedOn,
  });
}

/** Persist an already-generated Coach Insights result. See persistRacePrediction. */
export async function persistCoachInsights(
  userId: string,
  result: CoachInsightsResult,
  recomputedOn?: string,
): Promise<void> {
  await storage.analyticsResults.upsert({
    userId,
    feature: "coach_insights",
    payload: result,
    generatedAt: new Date(result.generatedAt),
    lastWorkoutDateAtGeneration: await getLatestWorkoutDate(userId),
    recomputedOn,
  });
}

/** Generate a race prediction and persist it as the user's stored result. */
export async function regenerateAndStoreRacePrediction(
  userId: string,
  log: Logger = defaultLogger,
  recomputedOn?: string,
): Promise<RacePredictionResponse> {
  const prediction = await generateRacePrediction(userId, log);
  await persistRacePrediction(userId, prediction, recomputedOn);
  return prediction;
}

/**
 * Generate Coach Insights and persist them as the user's stored result. Gating
 * is the caller's responsibility (route middleware). The cron path instead uses
 * generateCoachInsightsIfAllowed + persistCoachInsights so it can skip the AI
 * call entirely when consent/budget block it.
 */
export async function regenerateAndStoreCoachInsights(
  userId: string,
  log: Logger = defaultLogger,
  recomputedOn?: string,
): Promise<CoachInsightsResult> {
  const result = await generateCoachInsights(userId, log);
  await persistCoachInsights(userId, result, recomputedOn);
  return result;
}

/** Persist an already-generated Overview chart analysis. See persistCoachInsights. */
export async function persistOverviewAnalysis(
  userId: string,
  result: OverviewAnalysisResult,
  recomputedOn?: string,
): Promise<void> {
  await storage.analyticsResults.upsert({
    userId,
    feature: "overview_analysis",
    payload: result,
    generatedAt: new Date(result.generatedAt),
    lastWorkoutDateAtGeneration: await getLatestWorkoutDate(userId),
    recomputedOn,
  });
}

/**
 * Generate the Overview chart analysis and persist it as the user's stored
 * result. Gating is the caller's responsibility (route middleware). The cron
 * path instead uses generateOverviewAnalysisIfAllowed + persistOverviewAnalysis
 * so it can skip the AI call entirely when consent/budget block it.
 */
export async function regenerateAndStoreOverviewAnalysis(
  userId: string,
  log: Logger = defaultLogger,
  recomputedOn?: string,
): Promise<OverviewAnalysisResult> {
  const result = await generateOverviewAnalysis(userId, log);
  await persistOverviewAnalysis(userId, result, recomputedOn);
  return result;
}

/**
 * Persist an already-generated nutrition insights result. Unlike the training
 * surfaces, staleness is anchored on the latest FOOD-LOG date — a newly logged
 * meal (not a workout) is what makes nutrition insights stale — stored in the
 * generic lastWorkoutDateAtGeneration column (computeStale is feature-agnostic).
 */
export async function persistNutritionInsights(
  userId: string,
  result: NutritionInsightsResult,
  recomputedOn?: string,
): Promise<void> {
  await storage.analyticsResults.upsert({
    userId,
    feature: "nutrition_insights",
    payload: result,
    generatedAt: new Date(result.generatedAt),
    lastWorkoutDateAtGeneration: await storage.nutrition.getLatestLogDate(userId),
    recomputedOn,
  });
}

/** Generate nutrition insights and persist them. Gating is the caller's (route middleware). */
export async function regenerateAndStoreNutritionInsights(
  userId: string,
  log: Logger = defaultLogger,
  recomputedOn?: string,
): Promise<NutritionInsightsResult> {
  const result = await generateNutritionInsights(userId, log);
  await persistNutritionInsights(userId, result, recomputedOn);
  return result;
}

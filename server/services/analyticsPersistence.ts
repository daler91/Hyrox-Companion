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
import type { AnalyticsFeature, OverviewAnalysisResult, RacePredictionResponse } from "@shared/schema";
import type { Logger } from "pino";

import { logger as defaultLogger } from "../logger";
import { storage } from "../storage";
import type { HistoryAnchor } from "./analyticsStaleness";
import { type CoachInsightsResult, generateCoachInsights } from "./coachInsightsService";
import { generateNutritionInsights, type NutritionInsightsResult } from "./nutrition/nutritionInsightsService";
import { generateOverviewAnalysis } from "./overviewAnalysisService";
import { generateRacePrediction } from "./racePrediction/racePredictionService";

// Re-exported so route handlers can import the staleness check alongside the
// persistence helpers; the canonical (dependency-free) definition lives in
// analyticsStaleness so the recompute scheduler can use it in isolation.
export { computeStale, type HistoryAnchor } from "./analyticsStaleness";

/**
 * The athlete's workout history as the staleness check sees it: latest logged
 * date plus how many logs there are. Both queries run concurrently — they are
 * independent reads of the same table on an "instant paint" path. A write
 * landing between them can pair a stale date with a fresh count, which reads as
 * stale for that one request and corrects itself on the next; staleness is an
 * advisory flag, so that is the right trade for halving the latency.
 *
 * The count is what makes a second session on an already-logged day, or a
 * delete of anything but the single latest row, register as a change (audit
 * L16). Editing a workout in place still does not; see analyticsStaleness.
 */
export async function getWorkoutAnchor(userId: string): Promise<HistoryAnchor> {
  const [[latest], entryCount] = await Promise.all([
    storage.workouts.listWorkoutLogs(userId, 1),
    storage.workouts.countWorkoutLogs(userId),
  ]);
  return { latestDate: latest?.date ?? null, entryCount };
}

/** The food-log equivalent of getWorkoutAnchor, for nutrition_insights. */
export async function getNutritionAnchor(userId: string): Promise<HistoryAnchor> {
  const [latestDate, entryCount] = await Promise.all([
    storage.nutrition.getLatestLogDate(userId),
    storage.nutrition.countLogEntries(userId),
  ]);
  return { latestDate, entryCount };
}

/**
 * Map an anchor onto the analytics_results columns. The date column is named
 * `lastWorkoutDateAtGeneration` for historical reasons but holds whichever
 * anchor the feature uses — food-log date for nutrition_insights — because
 * computeStale is feature-agnostic.
 */
function anchorColumns(anchor: HistoryAnchor): {
  lastWorkoutDateAtGeneration: string | null;
  entryCountAtGeneration: number;
} {
  return {
    lastWorkoutDateAtGeneration: anchor.latestDate,
    entryCountAtGeneration: anchor.entryCount,
  };
}

/** Any generated analytics payload: every surface stamps its own generatedAt. */
interface GeneratedResult {
  generatedAt: string;
}

/**
 * Upsert one generated result as the user's stored row for `feature`. The
 * anchor is read here only when the caller did not capture one first (see
 * regenerateAndStore).
 */
async function upsertResult(
  userId: string,
  feature: AnalyticsFeature,
  result: GeneratedResult,
  readAnchor: (userId: string) => Promise<HistoryAnchor>,
  recomputedOn: string | undefined,
  anchor: HistoryAnchor | undefined,
): Promise<void> {
  await storage.analyticsResults.upsert({
    userId,
    feature,
    payload: result,
    generatedAt: new Date(result.generatedAt),
    ...anchorColumns(anchor ?? (await readAnchor(userId))),
    recomputedOn,
  });
}

/**
 * Capture the staleness anchor BEFORE generating, then persist. Generation
 * takes up to 90s (5 minutes for plans); a workout logged inside that window
 * used to be absorbed into an anchor read afterwards, so the stored result —
 * which never saw that workout — read as fresh until the athlete's next log.
 * Capturing early is strictly safer: worst case it over-reports staleness and
 * costs one extra recompute.
 */
async function regenerateAndStore<T extends GeneratedResult>(
  userId: string,
  feature: AnalyticsFeature,
  readAnchor: (userId: string) => Promise<HistoryAnchor>,
  generate: () => Promise<T>,
  recomputedOn: string | undefined,
): Promise<T> {
  const anchor = await readAnchor(userId);
  const result = await generate();
  await upsertResult(userId, feature, result, readAnchor, recomputedOn, anchor);
  return result;
}

/**
 * Persist an already-generated race prediction as the user's stored result.
 * Pass `recomputedOn` (a local YYYY-MM-DD) only from the cron path so the row
 * records the daily claim; omit it on manual refresh so the cron's once-per-day
 * guard is preserved. Pass `anchor` when it was captured before generation.
 */
export function persistRacePrediction(
  userId: string,
  prediction: RacePredictionResponse,
  recomputedOn?: string,
  anchor?: HistoryAnchor,
): Promise<void> {
  return upsertResult(userId, "race_prediction", prediction, getWorkoutAnchor, recomputedOn, anchor);
}

/** Persist an already-generated Coach Insights result. See persistRacePrediction. */
export function persistCoachInsights(
  userId: string,
  result: CoachInsightsResult,
  recomputedOn?: string,
  anchor?: HistoryAnchor,
): Promise<void> {
  return upsertResult(userId, "coach_insights", result, getWorkoutAnchor, recomputedOn, anchor);
}

/** Persist an already-generated Overview chart analysis. See persistCoachInsights. */
export function persistOverviewAnalysis(
  userId: string,
  result: OverviewAnalysisResult,
  recomputedOn?: string,
  anchor?: HistoryAnchor,
): Promise<void> {
  return upsertResult(userId, "overview_analysis", result, getWorkoutAnchor, recomputedOn, anchor);
}

/**
 * Persist an already-generated nutrition insights result. Unlike the training
 * surfaces, staleness is anchored on the latest FOOD-LOG date — a newly logged
 * meal (not a workout) is what makes nutrition insights stale — stored in the
 * generic lastWorkoutDateAtGeneration column (computeStale is feature-agnostic).
 */
export function persistNutritionInsights(
  userId: string,
  result: NutritionInsightsResult,
  recomputedOn?: string,
  anchor?: HistoryAnchor,
): Promise<void> {
  return upsertResult(userId, "nutrition_insights", result, getNutritionAnchor, recomputedOn, anchor);
}

/** Generate a race prediction and persist it as the user's stored result. */
export function regenerateAndStoreRacePrediction(
  userId: string,
  log: Logger = defaultLogger,
  recomputedOn?: string,
): Promise<RacePredictionResponse> {
  return regenerateAndStore(userId, "race_prediction", getWorkoutAnchor, () => generateRacePrediction(userId, log), recomputedOn);
}

/**
 * Generate Coach Insights and persist them as the user's stored result. Gating
 * is the caller's responsibility (route middleware). The cron path instead uses
 * generateCoachInsightsIfAllowed + persistCoachInsights so it can skip the AI
 * call entirely when consent/budget block it.
 */
export function regenerateAndStoreCoachInsights(
  userId: string,
  log: Logger = defaultLogger,
  recomputedOn?: string,
): Promise<CoachInsightsResult> {
  return regenerateAndStore(userId, "coach_insights", getWorkoutAnchor, () => generateCoachInsights(userId, log), recomputedOn);
}

/**
 * Generate the Overview chart analysis and persist it as the user's stored
 * result. Gating is the caller's responsibility (route middleware). The cron
 * path instead uses generateOverviewAnalysisIfAllowed + persistOverviewAnalysis
 * so it can skip the AI call entirely when consent/budget block it.
 */
export function regenerateAndStoreOverviewAnalysis(
  userId: string,
  log: Logger = defaultLogger,
  recomputedOn?: string,
): Promise<OverviewAnalysisResult> {
  return regenerateAndStore(userId, "overview_analysis", getWorkoutAnchor, () => generateOverviewAnalysis(userId, log), recomputedOn);
}

/** Generate nutrition insights and persist them. Gating is the caller's (route middleware). */
export function regenerateAndStoreNutritionInsights(
  userId: string,
  log: Logger = defaultLogger,
  recomputedOn?: string,
): Promise<NutritionInsightsResult> {
  return regenerateAndStore(userId, "nutrition_insights", getNutritionAnchor, () => generateNutritionInsights(userId, log), recomputedOn);
}

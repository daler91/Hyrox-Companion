import type { Logger } from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchRecomputeAnalytics } from "../recomputeAnalyticsDispatch";

// ---------------------------------------------------------------------------
// The dispatch is the seam that used to be broken: nutrition_insights jobs
// fell through to the coach-insights branch (wrong AI analysis, double spend,
// and a false recomputedOn stamp on the nutrition row). These tests pin the
// per-feature routing and the gated-outcome no-persist behavior.
// ---------------------------------------------------------------------------

vi.mock("../analyticsPersistence", () => ({
  getWorkoutAnchor: vi.fn().mockResolvedValue({ latestDate: "2026-09-01", entryCount: 3 }),
  getNutritionAnchor: vi.fn().mockResolvedValue({ latestDate: "2026-09-01", entryCount: 2 }),
  persistCoachInsights: vi.fn().mockResolvedValue(undefined),
  persistNutritionInsights: vi.fn().mockResolvedValue(undefined),
  persistOverviewAnalysis: vi.fn().mockResolvedValue(undefined),
  regenerateAndStoreRacePrediction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../coachInsightsService", () => ({
  generateCoachInsightsIfAllowed: vi.fn(),
}));
vi.mock("../nutrition/nutritionInsightsService", () => ({
  generateNutritionInsightsIfAllowed: vi.fn(),
}));
vi.mock("../overviewAnalysisService", () => ({
  generateOverviewAnalysisIfAllowed: vi.fn(),
}));

import {
  persistCoachInsights,
  persistNutritionInsights,
  persistOverviewAnalysis,
  regenerateAndStoreRacePrediction,
} from "../analyticsPersistence";
import { generateCoachInsightsIfAllowed } from "../coachInsightsService";
import { generateNutritionInsightsIfAllowed } from "../nutrition/nutritionInsightsService";
import { generateOverviewAnalysisIfAllowed } from "../overviewAnalysisService";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

const USER = "user-1";
const DATE = "2026-07-19";

describe("dispatchRecomputeAnalytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes nutrition_insights to the nutrition generator and persists via persistNutritionInsights", async () => {
    const result = { insights: "eat more carbs", generatedAt: "2026-07-19T00:00:00Z" };
    vi.mocked(generateNutritionInsightsIfAllowed).mockResolvedValue({ ok: true, result });

    await dispatchRecomputeAnalytics("nutrition_insights", USER, DATE, log);

    expect(generateNutritionInsightsIfAllowed).toHaveBeenCalledWith(USER, log);
    expect(persistNutritionInsights).toHaveBeenCalledWith(USER, result, DATE, {
      latestDate: "2026-09-01",
      entryCount: 2,
    });
    // The historical bug: nutrition jobs ran coach-insights generation.
    expect(generateCoachInsightsIfAllowed).not.toHaveBeenCalled();
    expect(persistCoachInsights).not.toHaveBeenCalled();
  });

  it("does not persist when the nutrition generation is gated", async () => {
    vi.mocked(generateNutritionInsightsIfAllowed).mockResolvedValue({
      ok: false,
      reason: "ai_consent_off",
    });

    await dispatchRecomputeAnalytics("nutrition_insights", USER, DATE, log);

    expect(persistNutritionInsights).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      { reason: "ai_consent_off" },
      expect.stringContaining("skipped"),
    );
  });

  it("routes coach_insights to the coach generator only", async () => {
    const result = { insights: "solid week", ragInfo: { used: false }, generatedAt: "2026-07-19T00:00:00Z" };
    vi.mocked(generateCoachInsightsIfAllowed).mockResolvedValue({
      ok: true,
      result: result as never,
    });

    await dispatchRecomputeAnalytics("coach_insights", USER, DATE, log);

    expect(generateCoachInsightsIfAllowed).toHaveBeenCalledWith(USER, log);
    expect(persistCoachInsights).toHaveBeenCalledWith(USER, result, DATE, {
      latestDate: "2026-09-01",
      entryCount: 3,
    });
    expect(generateNutritionInsightsIfAllowed).not.toHaveBeenCalled();
    expect(persistNutritionInsights).not.toHaveBeenCalled();
  });

  it("routes race_prediction to the deterministic regenerate path", async () => {
    await dispatchRecomputeAnalytics("race_prediction", USER, DATE, log);

    expect(regenerateAndStoreRacePrediction).toHaveBeenCalledWith(USER, log, DATE);
    expect(generateCoachInsightsIfAllowed).not.toHaveBeenCalled();
    expect(generateNutritionInsightsIfAllowed).not.toHaveBeenCalled();
    expect(generateOverviewAnalysisIfAllowed).not.toHaveBeenCalled();
  });

  it("routes overview_analysis to the overview generator only", async () => {
    const result = { analysis: "on track", generatedAt: "2026-07-19T00:00:00Z" };
    vi.mocked(generateOverviewAnalysisIfAllowed).mockResolvedValue({
      ok: true,
      result: result as never,
    });

    await dispatchRecomputeAnalytics("overview_analysis", USER, DATE, log);

    expect(generateOverviewAnalysisIfAllowed).toHaveBeenCalledWith(USER, log);
    expect(persistOverviewAnalysis).toHaveBeenCalledWith(USER, result, DATE, {
      latestDate: "2026-09-01",
      entryCount: 3,
    });
    expect(generateCoachInsightsIfAllowed).not.toHaveBeenCalled();
    expect(generateNutritionInsightsIfAllowed).not.toHaveBeenCalled();
  });
});

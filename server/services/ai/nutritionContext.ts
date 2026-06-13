import { estimatePlannedSession } from "@shared/plannedSessionEstimate";
import { computeSessionFuellingTarget } from "@shared/sessionFuellingTargets";

import { env } from "../../env";
import type { NutritionCoachContext } from "../../gemini/types";
import { logger } from "../../logger";
import type { UpcomingPlannedDay } from "../../storage/timeline";
import { buildNutritionSummary } from "../nutrition/nutritionSummary";

/**
 * Build the optional nutrition slice of the coach's training context (Phase 1 of
 * the nutrition↔training integration), so the AI coach and auto-suggestions can
 * reason about fuelling alongside training load.
 *
 * Returns `undefined` — so the coach prompt is unchanged from before this
 * feature — whenever:
 *   - the nutrition feature is disabled server-side (`env.NUTRITION_ENABLED`), or
 *   - the athlete has neither logged any food in the window nor set a target
 *     (nothing useful to say about fuelling), or
 *   - building the summary fails. Nutrition is supplementary: a failure here must
 *     degrade gracefully and never break chat or auto-suggestions.
 */
export async function buildNutritionTrainingContext(
  userId: string,
): Promise<NutritionCoachContext | undefined> {
  if (env.NUTRITION_ENABLED !== "true") return undefined;

  let summary;
  try {
    summary = await buildNutritionSummary(userId);
  } catch {
    // Plain static message — no err/object payload. Bearer flags structured
    // logger data here as potential information leakage (a caught error can
    // carry user nutrition data); matches the fix pattern in
    // nutritionInsightsService.
    logger.warn("[ai] nutrition context build failed; omitting from coach context");
    return undefined;
  }
  if (summary.loggedDaysCount === 0 && summary.target == null) return undefined;

  return {
    windowDays: summary.windowDays,
    loggedDaysCount: summary.loggedDaysCount,
    avgCalories: summary.avgLoggedDay.calories,
    avgProteinG: summary.avgLoggedDay.protein,
    avgCarbG: summary.avgLoggedDay.carb,
    avgFatG: summary.avgLoggedDay.fat,
    target: summary.target ?? undefined,
    highLoadDays: summary.highLoadDays.slice(0, 3).map((d) => ({
      date: d.date,
      utss: d.utss,
      calories: d.calories,
      proteinG: d.protein,
    })),
    lowMicros: summary.lowMicros.map((m) => `${m.label} ${m.pctRdi}%`),
  };
}

/**
 * Pre/post fuelling target for the next upcoming planned session (Phase 3b).
 * The athlete's saved expected duration/RPE win; otherwise both are estimated
 * from the planned exercise table (structure blocks + prescribed sets), the
 * same seeding the FuellingPlanPanel uses client-side, so the coach quotes the
 * numbers the athlete sees on the workout sheet.
 */
export function buildNextSessionFuelling(
  day: UpcomingPlannedDay,
  bodyweightKg: number | null,
  distanceUnit: string | null = null,
): NonNullable<NutritionCoachContext["nextSessionFuelling"]> {
  const estimate = estimatePlannedSession({
    structureBlocks: day.structureBlocks ?? [],
    exerciseSets: day.exerciseSets,
    distanceUnit,
  });
  const durationMin = day.expectedDurationMin ?? estimate.durationMin;
  const rpe = day.expectedRpe ?? estimate.rpe;
  const target = computeSessionFuellingTarget({ durationMin, rpe, bodyweightKg });

  return {
    date: day.date,
    focus: day.focus,
    durationMin,
    rpe,
    estimated: day.expectedDurationMin == null && day.expectedRpe == null,
    preCarbG: target.preCarbG,
    postCarbG: target.postCarbG,
    postProteinG: target.postProteinG,
  };
}

import type { TrainingContext } from "../gemini/types";
import { sanitizeUserInput } from "../utils/sanitize";
import { weekdayDate } from "./coachingContext";

/**
 * Format the athlete's recent fuelling vs training load for the coach prompt.
 * Returns "" when no nutrition context is present, so the prompt is byte-for-byte
 * unchanged for athletes without nutrition data (or with the feature off). Kept
 * compact (a handful of lines), matching the load-governor style, to avoid
 * bloating the context. No leading/trailing newlines — callers own spacing.
 *
 * Reused by both the chat system prompt (server/prompts.ts) and the
 * auto-suggestions prompt (server/gemini/suggestionService.ts) so the coach
 * describes fuelling identically across surfaces.
 */
type NutritionCtx = NonNullable<TrainingContext["nutrition"]>;

export function buildNutritionSection(trainingContext: TrainingContext): string {
  const n = trainingContext.nutrition;
  if (!n) return "";

  const lines = [
    `Fuelling and Recovery (last ${n.windowDays} days, ${n.loggedDaysCount} day${n.loggedDaysCount === 1 ? "" : "s"} logged):`,
    buildAvgLine(n),
    buildTargetLine(n.target),
    buildHighLoadLine(n.highLoadDays),
    buildLowMicrosLine(n),
    buildNextSessionLine(n.nextSessionFuelling),
  ].filter((line): line is string => line != null);

  return lines.join("\n");
}

function buildAvgLine(n: NutritionCtx): string {
  if (n.loggedDaysCount > 0) {
    return `- Avg on logged days: ${n.avgCalories} kcal, ${n.avgProteinG}g protein, ${n.avgCarbG}g carbs, ${n.avgFatG}g fat.`;
  }
  return "- No food logged in this window yet.";
}

function buildTargetParts(target: NonNullable<NutritionCtx["target"]>): string[] {
  return [
    target.calories == null ? null : `${target.calories} kcal`,
    target.proteinG == null ? null : `${target.proteinG}g protein`,
    target.carbG == null ? null : `${target.carbG}g carbs`,
    target.fatG == null ? null : `${target.fatG}g fat`,
  ].filter((part): part is string => part != null);
}

function buildTargetLine(target: NutritionCtx["target"]): string | null {
  if (!target) return null;
  const parts = buildTargetParts(target);
  return parts.length > 0 ? `- Daily target: ${parts.join(", ")}.` : null;
}

function buildHighLoadLine(highLoadDays: NutritionCtx["highLoadDays"]): string | null {
  if (highLoadDays.length === 0) return null;
  const days = highLoadDays
    .map((d) => `${d.date} (UTSS ${d.utss}: ${d.calories} kcal, ${d.proteinG}g protein)`)
    .join("; ");
  return `- Highest training-load days — ${days}.`;
}

/**
 * Edamam foods never carry micronutrients and many cached foods have none yet,
 * so even a full day's figures cover only part of what was eaten. Shared with
 * the nutrition-insights prompt so the coach and the insights panel hedge alike.
 */
export const MICRO_COVERAGE_CAVEAT =
  "Only foods with micronutrient data are counted, so a low figure may be a data gap rather than a shortfall.";

/**
 * The hedge for an all-clear, which carried the caveat above and so spoke of
 * "a low figure" when nothing was low. What partial coverage hides in an
 * all-clear is a micro no counted food reports: it is never judged at all.
 * C8 (CODEBASE_ANALYSIS_2026-10-03)
 */
export const MICRO_ALL_CLEAR_CAVEAT =
  "Only foods with micronutrient data are counted and micros they don't report aren't judged, so an all-clear can still miss a gap.";

// Micros are judged on the latest complete logged day (up to 13 days back),
// never the part-eaten today, yet this line said "low today": name the day,
// and carry the partial-coverage caveat. C8 (CODEBASE_ANALYSIS_2026-10-03)
function buildLowMicrosLine(n: NutritionCtx): string | null {
  if (n.lowMicros.length === 0) return null;
  const day =
    n.microDate == null
      ? "the latest complete logged day"
      : `${n.microDate}, the latest complete logged day`;
  return `- Micronutrients under 50% of reference intake on ${day}: ${n.lowMicros.join(", ")}. ${MICRO_COVERAGE_CAVEAT}`;
}

function buildNextSessionLine(s: NutritionCtx["nextSessionFuelling"]): string | null {
  if (!s) return null;
  const effort = [
    s.durationMin == null ? null : `~${s.durationMin} min`,
    s.rpe == null ? null : `RPE ${s.rpe}`,
  ]
    .filter(Boolean)
    .join(" at ");
  const pre = s.preCarbG > 0 ? `aim ~${s.preCarbG}g carbs beforehand` : "no pre-fuelling needed";
  const basis = s.estimated ? "; estimated from the planned exercises" : "";
  const effortSuffix = effort ? `, ${effort}` : "";
  // s.focus is user-editable (planDays.focus) and flows into the AI system prompt — sanitize to
  // prevent breaking out of the <user_input> delimiter scheme (mirrors coachingContext.ts / suggestionService.ts).
  return `- Next planned session (${weekdayDate(s.date)}, ${sanitizeUserInput(s.focus)}${effortSuffix}): ${pre}, then ~${s.postCarbG}g carbs + ${s.postProteinG}g protein to recover${basis}.`;
}

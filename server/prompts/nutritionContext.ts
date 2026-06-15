import type { TrainingContext } from "../gemini/types";

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
    buildLowMicrosLine(n.lowMicros),
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
    target.calories != null ? `${target.calories} kcal` : null,
    target.proteinG != null ? `${target.proteinG}g protein` : null,
    target.carbG != null ? `${target.carbG}g carbs` : null,
    target.fatG != null ? `${target.fatG}g fat` : null,
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

function buildLowMicrosLine(lowMicros: NutritionCtx["lowMicros"]): string | null {
  if (lowMicros.length === 0) return null;
  return `- Micronutrients low today (under 50% reference): ${lowMicros.join(", ")}.`;
}

function buildNextSessionLine(s: NutritionCtx["nextSessionFuelling"]): string | null {
  if (!s) return null;
  const effort = [
    s.durationMin != null ? `~${s.durationMin} min` : null,
    s.rpe != null ? `RPE ${s.rpe}` : null,
  ]
    .filter(Boolean)
    .join(" at ");
  const pre = s.preCarbG > 0 ? `aim ~${s.preCarbG}g carbs beforehand` : "no pre-fuelling needed";
  const basis = s.estimated ? "; estimated from the planned exercises" : "";
  const effortSuffix = effort ? `, ${effort}` : "";
  return `- Next planned session (${s.date}, ${s.focus}${effortSuffix}): ${pre}, then ~${s.postCarbG}g carbs + ${s.postProteinG}g protein to recover${basis}.`;
}

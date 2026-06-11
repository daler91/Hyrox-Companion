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
export function buildNutritionSection(trainingContext: TrainingContext): string {
  const n = trainingContext.nutrition;
  if (!n) return "";

  const lines: string[] = [
    `Fuelling and Recovery (last ${n.windowDays} days, ${n.loggedDaysCount} day${n.loggedDaysCount === 1 ? "" : "s"} logged):`,
  ];

  if (n.loggedDaysCount > 0) {
    lines.push(
      `- Avg on logged days: ${n.avgCalories} kcal, ${n.avgProteinG}g protein, ${n.avgCarbG}g carbs, ${n.avgFatG}g fat.`,
    );
  } else {
    lines.push(`- No food logged in this window yet.`);
  }

  if (n.target) {
    const parts = [
      n.target.calories != null ? `${n.target.calories} kcal` : null,
      n.target.proteinG != null ? `${n.target.proteinG}g protein` : null,
      n.target.carbG != null ? `${n.target.carbG}g carbs` : null,
      n.target.fatG != null ? `${n.target.fatG}g fat` : null,
    ].filter(Boolean);
    if (parts.length > 0) lines.push(`- Daily target: ${parts.join(", ")}.`);
  }

  if (n.highLoadDays.length > 0) {
    const days = n.highLoadDays
      .map((d) => `${d.date} (UTSS ${d.utss}: ${d.calories} kcal, ${d.proteinG}g protein)`)
      .join("; ");
    lines.push(`- Highest training-load days — ${days}.`);
  }

  if (n.lowMicros.length > 0) {
    lines.push(`- Micronutrients low today (under 50% reference): ${n.lowMicros.join(", ")}.`);
  }

  if (n.nextSessionFuelling) {
    const s = n.nextSessionFuelling;
    const effort = [
      s.durationMin != null ? `~${s.durationMin} min` : null,
      s.rpe != null ? `RPE ${s.rpe}` : null,
    ]
      .filter(Boolean)
      .join(" at ");
    const pre = s.preCarbG > 0 ? `aim ~${s.preCarbG}g carbs beforehand` : "no pre-fuelling needed";
    const basis = s.estimated ? "; estimated from the planned exercises" : "";
    lines.push(
      `- Next planned session (${s.date}, ${s.focus}${effort ? `, ${effort}` : ""}): ${pre}, then ~${s.postCarbG}g carbs + ${s.postProteinG}g protein to recover${basis}.`,
    );
  }

  return lines.join("\n");
}

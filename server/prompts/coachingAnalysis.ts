import type { TrainingLoadOverview } from "@shared/schema";

import type { TrainingContext } from "../gemini/types";
import { sanitizeUserInput } from "../utils/sanitize";

type CoachingInsights = NonNullable<TrainingContext["coachingInsights"]>;

/**
 * Shared renderer for the COACHING ANALYSIS block. Used by BOTH the
 * conversational chat / Coach-Insights prompt (server/prompts.ts
 * buildSystemPrompt) and the auto-coach suggestion / review-note prompts
 * (server/gemini/suggestionService.ts), so the two paths never drift. Every
 * block self-suppresses when its signal is unremarkable to keep the prompt
 * bounded for calm athletes.
 */

function formatRpeTrend(insights: CoachingInsights): string {
  if (insights.rpeTrend === "insufficient_data") {
    return `RPE TREND: Insufficient data (fewer than 3 workouts with RPE logged).`;
  }

  let rpeLine = `RPE TREND: ${insights.rpeTrend.toUpperCase()}`;
  if (insights.avgRpeLast3 != null) rpeLine += ` (avg ${insights.avgRpeLast3} last 3 workouts`;
  if (insights.avgRpePrior3 != null) rpeLine += ` vs ${insights.avgRpePrior3} prior 3`;
  if (insights.avgRpeLast3 != null) rpeLine += `)`;
  if (insights.fatigueFlag)
    rpeLine += `. FATIGUE FLAG ACTIVE - analyze the upcoming workout fit before reducing volume.`;
  if (insights.undertrainingFlag)
    rpeLine += `. UNDERTRAINING FLAG ACTIVE — athlete needs more intensity.`;
  // A bare trend with neither flag set used to be handed over uninterpreted,
  // and the model filled the gap the wrong way round — reading a FALLING RPE
  // back to the athlete as a sign of "accumulating fatigue". The direction is
  // not ambiguous, so state it rather than leaving it to be guessed at.
  else if (!insights.fatigueFlag && insights.rpeTrend === "falling")
    rpeLine += `. Sessions are being reported as EASIER than before — a deload, a lighter block, or improving fitness. It is not evidence of accumulating fatigue; that shows up as RPE RISING at the same workload.`;
  return rpeLine;
}

function formatStationGapEntry(
  g: CoachingInsights["stationGaps"][0],
  severity: "critical" | "high",
): string {
  if (severity === "critical") {
    const label =
      g.daysSinceLastTrained === null ? "NEVER TRAINED" : `${g.daysSinceLastTrained} days`;
    return `${g.station} (${label} — CRITICAL)`;
  }
  return `${g.station} (${g.daysSinceLastTrained} days — needs attention)`;
}

function formatStationGaps(stationGaps: CoachingInsights["stationGaps"]): string {
  const criticalGaps = stationGaps.filter(
    (g) => g.daysSinceLastTrained === null || g.daysSinceLastTrained >= 14,
  );
  const highGaps = stationGaps.filter(
    (g) =>
      g.daysSinceLastTrained != null && g.daysSinceLastTrained >= 10 && g.daysSinceLastTrained < 14,
  );
  const okCount = stationGaps.filter(
    (g) => g.daysSinceLastTrained != null && g.daysSinceLastTrained < 10,
  ).length;

  const gapParts: string[] = [];
  for (const g of criticalGaps) gapParts.push(formatStationGapEntry(g, "critical"));
  for (const g of highGaps) gapParts.push(formatStationGapEntry(g, "high"));

  if (okCount > 0 && gapParts.length > 0) {
    gapParts.push(`${okCount} exercises OK (<10 days)`);
  } else if (gapParts.length === 0) {
    gapParts.push(`All exercises trained within 10 days — good coverage.`);
  }

  return `EXERCISE GAPS: ${gapParts.join(", ")}`;
}

/**
 * Map TSB ("Form") to a short fatigue/freshness label. Thresholds are aligned
 * with computeRaceReadiness's bands (race-prediction service) so the coach's
 * day-to-day Form language never contradicts its taper guidance — borrowed as
 * thresholds only, not by importing the readiness function.
 */
function tsbLabel(tsb: number): string {
  if (tsb >= 15) return "well-rested / peaked";
  if (tsb >= 5) return "fresh";
  if (tsb >= -10) return "balanced";
  if (tsb >= -25) return "fatigued — carrying load";
  return "very fatigued — recovery bias";
}

/**
 * Surface the load governor as a binding auto-regulation block — but only when
 * it is actionable (active restrictions, a yellow/danger ACWR zone, notable
 * Form/TSB, or an elevated monotony zone). Returns null otherwise so
 * sweet-spot / insufficient-history athletes get an unchanged prompt. The
 * restriction `rationale` strings already name exactly what to avoid, so they
 * are reused verbatim.
 */
/** Append a block when it has something to say; a null block self-suppressed. */
function pushBlock(lines: string[], block: string | null): void {
  if (block) lines.push(block);
}

function formatAcwrLine(lg: TrainingLoadOverview): string | null {
  if (lg.acwr == null || lg.zone === "insufficient_data") return null;
  return `- ACWR ${lg.acwr.toFixed(2)} — ${lg.zone.replaceAll("_", " ").toUpperCase()} zone.`;
}

function formatFormLine(lg: TrainingLoadOverview, worthReporting: boolean): string | null {
  if (lg.tsb == null || !worthReporting) return null;
  return `- Form (TSB) ${lg.tsb >= 0 ? "+" : ""}${Math.round(lg.tsb)} — ${tsbLabel(lg.tsb)}.`;
}

function formatMonotonyLine(lg: TrainingLoadOverview): string {
  const monotonyStr = lg.monotony != null ? lg.monotony.toFixed(2) : "elevated";
  const strainStr = lg.strain != null ? `, strain ${Math.round(lg.strain)}` : "";
  const zoneLabel = lg.monotonyZone === "high_risk" ? "HIGH RISK" : "elevated";
  return `- Training monotony ${monotonyStr}${strainStr} — ${zoneLabel}. Vary intensity and protect a true easy/rest day.`;
}

/** Lowest-value display metrics — one terse optional line, only when present. */
function formatObjectiveLoadLine(lg: TrainingLoadOverview): string | null {
  const objective: string[] = [];
  if (lg.hrTss != null) {
    objective.push(`hrTSS ${Math.round(lg.hrTss)}${lg.hrZone ? ` (${lg.hrZone.toUpperCase()})` : ""}`);
  }
  if (lg.tss != null) objective.push(`power TSS ${Math.round(lg.tss)}`);
  if (objective.length === 0) return null;
  return `- Objective load today: ${objective.join(", ")}.`;
}

function formatLoadGovernor(lg: TrainingLoadOverview | undefined): string | null {
  if (!lg) return null;
  const gatingZone = lg.zone === "yellow" || lg.zone === "danger";
  // Form is "notable" outside the balanced band [-10, 5] computeRaceReadiness uses.
  const notableForm = lg.tsb != null && (lg.tsb < -10 || lg.tsb >= 5);
  const elevatedMonotony = lg.monotonyZone === "elevated" || lg.monotonyZone === "high_risk";
  const hasObjectiveLoad = lg.hrTss != null || lg.tss != null;

  if (
    lg.activeRestrictions.length === 0 &&
    !gatingZone &&
    !notableForm &&
    !elevatedMonotony &&
    !hasObjectiveLoad
  ) {
    return null;
  }

  const lines = ["LOAD GOVERNOR (auto-regulation — binding):"];
  pushBlock(lines, formatAcwrLine(lg));
  pushBlock(lines, formatFormLine(lg, notableForm || gatingZone));
  if (elevatedMonotony) lines.push(formatMonotonyLine(lg));
  if (lg.flaggedVectors.length > 0) {
    lines.push(`- Flagged tissue load: ${lg.flaggedVectors.map((v) => v.replaceAll("_", " ")).join(", ")}.`);
  }
  for (const restriction of lg.activeRestrictions) {
    lines.push(`- ${restriction.label}: ${restriction.rationale}`);
  }
  pushBlock(lines, formatObjectiveLoadLine(lg));
  lines.push(
    `- Some upcoming sessions may already be auto-adjusted by the governor (downshifted to a Recovery Run, or trimmed in volume); do not re-add intensity to those.`,
  );
  return lines.join("\n");
}

/**
 * Training decision-engine state. A SOFT gate that complements the load
 * governor: when intensity is not permitted, bias toward the allowed workout
 * types regardless of other signals.
 */
function formatDecisionTree(decisionTree: CoachingInsights["decisionTree"]): string | null {
  if (!decisionTree) return null;
  const phase = decisionTree.currentPhase.replaceAll("_", " ");
  const intensity = decisionTree.intensityPermitted
    ? "intensity permitted"
    : "intensity NOT permitted (hold back hard efforts)";
  const lines = [`TRAINING STATE: ${phase.toUpperCase()} phase — ${intensity}.`];
  if (decisionTree.allowedWorkoutTypes.length > 0) {
    lines.push(
      `- Allowed session types: ${decisionTree.allowedWorkoutTypes.map((t) => t.replaceAll("_", " ")).join(", ")}.`,
    );
  }
  if (decisionTree.rationaleCodes.length > 0) {
    lines.push(`- Why: ${decisionTree.rationaleCodes.map((c) => c.replaceAll("_", " ")).join(", ")}.`);
  }
  return lines.join("\n");
}

/** Deterministic race-day readiness (taper guidance only — never inflate volume). */
function formatRaceReadiness(readiness: CoachingInsights["raceReadiness"]): string | null {
  if (!readiness || readiness.status === "insufficient_data") return null;
  const tsbStr = readiness.tsb != null ? ` (TSB ${readiness.tsb >= 0 ? "+" : ""}${readiness.tsb})` : "";
  return `RACE READINESS: ${readiness.status.replaceAll("_", " ").toUpperCase()}${tsbStr} — ${readiness.guidance}`;
}

function formatPersonalRecords(insights: CoachingInsights): string | null {
  if (!insights.personalRecords || insights.personalRecords.length === 0) return null;
  const entries = insights.personalRecords.map((pr) => `${pr.exercise} ${pr.display}`);
  let line = `PERSONAL RECORDS (recent bests): ${entries.join("; ")}.`;
  if (insights.prsThisWeek && insights.prsThisWeek > 0) {
    line += ` ${insights.prsThisWeek} new best${insights.prsThisWeek === 1 ? "" : "s"} this week — acknowledge it.`;
  }
  line += ` Anchor progressive overload on the estimated 1RM (e1RM) where shown.`;
  return line;
}

function formatCompliance(compliance: CoachingInsights["compliance"]): string | null {
  // Only worth surfacing when adherence is meaningfully off-target; near-100%
  // compliance needs no coaching note.
  if (!compliance || compliance.avgPct >= 85) return null;
  return `PLAN COMPLIANCE: ${compliance.avgPct}% adherence over the last ${compliance.windowDays} days — the prescription may be mis-calibrated (too hard/long). Prefer right-sizing sessions over adding volume.`;
}

function formatCoverageGaps(insights: CoachingInsights): string | null {
  const parts: string[] = [];
  const render = (
    items: Array<{ label: string; daysSince: number | null }> | undefined,
  ): string | null => {
    if (!items || items.length === 0) return null;
    return items
      .map((i) => `${i.label} (${i.daysSince === null ? "never" : `${i.daysSince}d`})`)
      .join(", ");
  };
  const patterns = render(insights.neglectedPatterns);
  const muscles = render(insights.neglectedMuscles);
  if (patterns) parts.push(`movement patterns: ${patterns}`);
  if (muscles) parts.push(`muscle groups: ${muscles}`);
  if (parts.length === 0) return null;
  return `COVERAGE GAPS (general balance — ${parts.join("; ")}). Distinct from station gaps; address for balanced development, especially for non-Hyrox goals.`;
}

function formatPlanPhase(planPhase: CoachingInsights["planPhase"]): string | null {
  if (!planPhase) return null;
  const p = planPhase;
  const remaining =
    p.remainingPhases.length > 0
      ? ` Remaining phases: ${p.remainingPhases.map((phase) => phase.toUpperCase()).join(" → ")}.`
      : "";
  return `PLAN PHASE: Week ${p.currentWeek} of ${p.totalWeeks} (${p.phaseLabel.toUpperCase()} phase, ${p.progressPct}% complete). Coach according to ${p.phaseLabel} phase guidelines.${remaining}`;
}

function formatProgressionFlags(flags: CoachingInsights["progressionFlags"]): string | null {
  if (flags.length === 0) return null;
  const flagLines = flags.map((f) => `${f.exercise}: ${f.flag.toUpperCase()} — ${f.detail}`);
  return `PROGRESSION:\n${flagLines.join("\n")}`;
}

function formatWeeklyVolume(weeklyVolume: CoachingInsights["weeklyVolume"]): string | null {
  if (!weeklyVolume) return null;
  const v = weeklyVolume;
  return `WEEKLY VOLUME: ${v.thisWeekCompleted}/${v.goal} goal this week (last week: ${v.lastWeekCompleted}/${v.goal}). Trend: ${v.trend}.`;
}

function formatAthleteGoal(planGoal: string | undefined): string | null {
  if (!planGoal) return null;
  return `ATHLETE'S GOAL: "${sanitizeUserInput(planGoal)}"`;
}

/**
 * Assemble the full COACHING ANALYSIS block from the pre-computed insights.
 * Every sub-block self-suppresses when its signal is unremarkable.
 */
const SKIP_REASON_PROMPT_LABELS: Record<string, string> = {
  ill: "ill",
  injured: "injured",
  schedule: "schedule conflict",
  low_energy: "low energy",
};

/**
 * The skips the athlete explained, and what to do with the two medical ones.
 * Self-suppresses when nothing was volunteered — a reasonless skip carries no
 * coaching signal and is not re-litigated here.
 */
function formatRecentSkips(recentSkips: CoachingInsights["recentSkips"]): string {
  if (!recentSkips || recentSkips.length === 0) return "";
  const items = recentSkips
    // s.focus is free-text plan_days.focus (athlete-editable) — sanitize before
    // it reaches the LLM prompt, same as every other user-authored field here.
    .map(
      (s) =>
        `${s.date} ${sanitizeUserInput(s.focus)} (${SKIP_REASON_PROMPT_LABELS[s.reason] ?? s.reason})`,
    )
    .join("; ");
  return `RECENT SKIPS (athlete-stated reasons): ${items}. Treat ill/injured skips as recovery signals to program around — not as compliance failures to nudge about.`;
}

export function formatCoachingAnalysis(insights: CoachingInsights, planGoal?: string): string {
  const lines: string[] = [
    `--- COACHING ANALYSIS ---`,
    formatRpeTrend(insights),
    formatStationGaps(insights.stationGaps),
  ];

  pushBlock(lines, formatRecentSkips(insights.recentSkips));

  pushBlock(lines, formatLoadGovernor(insights.loadGovernor));
  pushBlock(lines, formatDecisionTree(insights.decisionTree));
  pushBlock(lines, formatRaceReadiness(insights.raceReadiness));
  pushBlock(lines, formatPlanPhase(insights.planPhase));
  pushBlock(lines, formatProgressionFlags(insights.progressionFlags));
  pushBlock(lines, formatPersonalRecords(insights));
  pushBlock(lines, formatWeeklyVolume(insights.weeklyVolume));
  pushBlock(lines, formatCompliance(insights.compliance));
  pushBlock(lines, formatCoverageGaps(insights));
  pushBlock(lines, formatAthleteGoal(planGoal));

  lines.push(`--- END COACHING ANALYSIS ---`);
  return lines.join("\n");
}

import type { SessionGradeRollupCounts, SessionGradeWeek } from "@shared/schema";

/**
 * The four stacks of the weekly chart, in reading order: did its job, drifted
 * a little, missed its purpose, can't tell. Colours are the app's status steps
 * (validated for light and dark surfaces); each also has a label and an icon
 * in the legend and tooltip, so colour is never the only signal.
 */
export const GRADE_SERIES = [
  { key: "onTarget", label: "Did its job", color: "#059669" },
  { key: "partial", label: "Crept up / under", color: "#d97706" },
  { key: "missed", label: "Too hard / drifted harder", color: "#e11d48" },
  { key: "unclear", label: "Can't tell", color: "#64748b" },
] as const;

export type GradeSeriesKey = (typeof GRADE_SERIES)[number]["key"];

export interface GradeChartRow extends Record<GradeSeriesKey, number> {
  week: string;
  weekNumber: number;
  weekStart: string | null;
  deload: boolean;
  phase: SessionGradeWeek["phase"];
  counts: SessionGradeRollupCounts;
}

export function toGradeChartRow(week: SessionGradeWeek): GradeChartRow {
  const { easy, threshold } = week.counts;
  return {
    week: `W${week.weekNumber}`,
    weekNumber: week.weekNumber,
    weekStart: week.weekStart,
    deload: week.deload,
    phase: week.phase,
    counts: week.counts,
    onTarget: easy.onTarget + threshold.onTarget,
    partial: easy.creptUp + threshold.under,
    missed: easy.tooHard + threshold.driftedHarder,
    unclear: easy.inconclusive + threshold.inconclusive + easy.ungradeable + threshold.ungradeable,
  };
}

/** "3 of 4" style share of definite easy (or threshold) verdicts that were on target. */
export function intentOnTarget(counts: SessionGradeRollupCounts, intent: "easy" | "threshold"): {
  onTarget: number;
  graded: number;
} {
  const c = counts[intent];
  const graded = c.onTarget + c.creptUp + c.tooHard + c.driftedHarder + c.under;
  return { onTarget: c.onTarget, graded };
}

export function formatShare(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

/** Phase labels as the rest of the app writes them. */
export function phaseLabel(phase: SessionGradeWeek["phase"]): string | null {
  if (!phase) return null;
  if (phase === "race_week") return "Race week";
  return `${phase.charAt(0).toUpperCase()}${phase.slice(1)}`;
}

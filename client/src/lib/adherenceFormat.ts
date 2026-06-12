/**
 * Shared adherence (planned-vs-actual compliance %) presentation. The
 * thresholds — 85% "on plan" (green), 60% "partial" (amber), below that
 * "off plan" (rose) — are used by both the timeline card badge and the
 * workout-detail summary tiles so a given percentage always reads the
 * same colour wherever it appears.
 */
export type AdherenceTone = "good" | "partial" | "low";

export function getAdherenceTone(compliancePct: number): AdherenceTone {
  if (compliancePct >= 85) return "good";
  if (compliancePct >= 60) return "partial";
  return "low";
}

const ADHERENCE_TONE_CLASSNAMES: Record<AdherenceTone, string> = {
  good: "border-emerald-300 text-emerald-700 bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:bg-emerald-950",
  partial:
    "border-amber-300 text-amber-700 bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:bg-amber-950",
  low: "border-rose-300 text-rose-700 bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:bg-rose-950",
};

export function getAdherenceToneClassName(compliancePct: number): string {
  return ADHERENCE_TONE_CLASSNAMES[getAdherenceTone(compliancePct)];
}

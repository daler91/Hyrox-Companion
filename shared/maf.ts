export type MafConsistency = "low" | "moderate" | "high";
export type MafTrend = "improving" | "flat" | "declining";

export interface MafInput {
  age: number;
  injuryIllnessMedication: boolean;
  consistency: MafConsistency;
  trend: MafTrend;
}

export interface MafResult {
  base: number;
  adjustment: -10 | -5 | 0 | 5;
  ceiling: number;
  reasonCodes: string[];
  explanation: string;
  warning: string | null;
}

export function calculateMafHr(input: MafInput): MafResult {
  const base = 180 - input.age;
  const reasonCodes: string[] = [];
  let adjustment: -10 | -5 | 0 | 5 = 0;
  let warning: string | null = null;

  if (input.age < 16) {
    adjustment = -10;
    warning = "Under-16 athletes should use clinician-guided override; conservative default applied.";
    reasonCodes.push("age_under_16_manual_override_recommended", "adjustment_-10");
  } else if (input.injuryIllnessMedication) {
    adjustment = -10;
    reasonCodes.push("injury_illness_medication", "adjustment_-10");
  } else if (input.age > 65) {
    adjustment = -5;
    warning = "Over-65 athletes should confirm with clinician; conservative default applied.";
    reasonCodes.push("age_over_65_conservative_default", "adjustment_-5");
  } else if (input.consistency === "low" || input.trend === "declining") {
    adjustment = -5;
    reasonCodes.push("low_consistency_or_declining_trend", "adjustment_-5");
  } else if (input.consistency === "moderate" || input.trend === "flat") {
    reasonCodes.push("moderate_consistency_or_flat_trend", "adjustment_0");
  } else {
    adjustment = 5;
    reasonCodes.push("high_consistency_and_improving_trend", "adjustment_+5");
  }

  const ceiling = base + adjustment;
  const explanation = `MAF base ${base} (180-age), adjustment ${adjustment}, final ceiling ${ceiling}.`;

  return { base, adjustment, ceiling, reasonCodes, explanation, warning };
}

export type MafComplianceClass = "compliant" | "mostly_compliant" | "over_ceiling";

export interface MafComplianceInput {
  /** Average heart rate held over the effort (bpm). */
  avgHeartRate: number;
  /** Peak heart rate, when available (bpm). */
  maxHeartRate?: number | null;
  /** The athlete's MAF aerobic ceiling (bpm). */
  ceiling: number;
}

export interface MafComplianceResult {
  /** 0–100. 100 = held at/under the ceiling; drops as the average runs over it. */
  compliancePct: number;
  classification: MafComplianceClass;
  /** Short, actionable coaching cue for the athlete. */
  nextAction: string;
  details: {
    avgHeartRate: number;
    maxHeartRate: number | null;
    ceiling: number;
    /** avgHeartRate − ceiling (positive = over). */
    avgOverBy: number;
    /** maxHeartRate − ceiling, or null when peak HR is unknown. */
    maxOverBy: number | null;
  };
}

// How far the average HR can run over the ceiling before compliance hits 0.
// 6 points per bpm means ~17 bpm over → 0%, which matches how quickly aerobic
// benefit falls off once you push past the MAF ceiling.
const COMPLIANCE_PENALTY_PER_BPM = 6;
// Peak HR is allowed to brush a little over the ceiling (hills, surges) before
// a sub-ceiling average is downgraded from "compliant" to "mostly_compliant".
const PEAK_DRIFT_TOLERANCE_BPM = 5;

/**
 * Score how well a single effort respected the MAF heart-rate ceiling, from the
 * average (and optional peak) HR the app stores per workout. This is the basis
 * for `maf_workout_analysis` rows when a run is logged as a MAF test.
 */
export function computeMafCompliance(input: MafComplianceInput): MafComplianceResult {
  const { avgHeartRate, ceiling } = input;
  const maxHeartRate = input.maxHeartRate ?? null;
  const avgOverBy = avgHeartRate - ceiling;
  const maxOverBy = maxHeartRate != null ? maxHeartRate - ceiling : null;

  let compliancePct: number;
  let classification: MafComplianceClass;
  let nextAction: string;

  if (avgOverBy <= 0) {
    const driftedAtPeaks = maxOverBy != null && maxOverBy > PEAK_DRIFT_TOLERANCE_BPM;
    if (driftedAtPeaks) {
      compliancePct = 85;
      classification = "mostly_compliant";
      nextAction =
        "Your average stayed under the ceiling, but heart rate spiked above it — ease off on climbs and surges to keep the peaks in check.";
    } else {
      compliancePct = 100;
      classification = "compliant";
      nextAction = "On target — keep building aerobic volume at this effort.";
    }
  } else {
    compliancePct = Math.max(0, Math.round(100 - avgOverBy * COMPLIANCE_PENALTY_PER_BPM));
    classification = "over_ceiling";
    nextAction = `Your average was ${avgOverBy} bpm over your MAF ceiling — slow down (walk the hills if you need to) so the effort trains the aerobic system.`;
  }

  return {
    compliancePct,
    classification,
    nextAction,
    details: { avgHeartRate, maxHeartRate, ceiling, avgOverBy, maxOverBy },
  };
}

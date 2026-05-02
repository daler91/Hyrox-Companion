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

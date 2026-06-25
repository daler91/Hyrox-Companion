/**
 * Roadmap G — fuelling↔performance correlation (pure). Buckets training days by
 * whether the athlete reached their (load-adjusted) carb target and compares the
 * day's session RPE and prescription compliance across the buckets: "on days you
 * hit your carbs, RPE/compliance was better".
 *
 * Browser-safe and DB-free, mirroring `shared/sessionFuellingTargets.ts`: typed
 * Input/Result, `reasonCodes` + `explanation`, no I/O. Min-N guards keep small
 * samples honest, and the output is framed as an association, not causation.
 */

export interface FuellingCorrelationDay {
  /** Carbs logged that day (g). */
  carbG: number;
  /** The day's effective carb target (g), or null when no target was in force. */
  carbTargetG: number | null;
  /** Mean session RPE across that day's logged workouts, or null when unrecorded. */
  avgRpe: number | null;
  /** Mean prescription compliance (%) across that day's workouts, or null. */
  compliancePct: number | null;
}

export interface FuellingMetricComparison {
  hitDays: number;
  missDays: number;
  hitAvg: number;
  missAvg: number;
  /** hitAvg − missAvg (for RPE, negative = sessions felt easier on hit days). */
  delta: number;
}

export interface FuellingCorrelationResult {
  status: "ok" | "insufficient_data";
  rpe: FuellingMetricComparison | null;
  compliance: FuellingMetricComparison | null;
  /** Days with both a carb target and at least one recorded outcome metric. */
  eligibleDays: number;
  /** The hit threshold as a percentage of the carb target (e.g. 90). */
  carbHitPct: number;
  reasonCodes: string[];
  explanation: string;
}

/** A day "hits" its carbs at ≥90% of the effective target. */
export const CARB_HIT_RATIO = 0.9;
/** Each bucket needs this many days before a comparison is reported. */
export const MIN_DAYS_PER_BUCKET = 3;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function mean(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/** Compare one metric across hit/miss buckets; null (with a reason) under min-N. */
function compareMetric(
  days: ReadonlyArray<{ hit: boolean; value: number }>,
  round: (n: number) => number,
  insufficientCode: string,
  reasonCodes: string[],
): FuellingMetricComparison | null {
  // Replaced chained .filter().map() with a single for...of loop to prevent intermediate array allocations
  const hit: number[] = [];
  const miss: number[] = [];
  for (const d of days) {
    if (d.hit) hit.push(d.value);
    else miss.push(d.value);
  }
  if (hit.length < MIN_DAYS_PER_BUCKET || miss.length < MIN_DAYS_PER_BUCKET) {
    if (days.length > 0) reasonCodes.push(insufficientCode);
    return null;
  }
  return {
    hitDays: hit.length,
    missDays: miss.length,
    hitAvg: round(mean(hit)),
    missAvg: round(mean(miss)),
    // From the raw means, not the rounded ones — rounding first can drift the
    // reported difference by up to one display unit.
    delta: round(mean(hit) - mean(miss)),
  };
}

export function analyzeFuellingCorrelation(
  days: readonly FuellingCorrelationDay[],
): FuellingCorrelationResult {
  const reasonCodes: string[] = [];

  // Only days where "hit the carb target" is even defined, and something
  // measurable happened in training.
  // Replaced chained .filter().filter().map() with a single for...of loop to reduce garbage collection overhead
  const eligible: (FuellingCorrelationDay & { hit: boolean })[] = [];
  for (const d of days) {
    if (
      d.carbTargetG != null &&
      d.carbTargetG > 0 &&
      (d.avgRpe != null || d.compliancePct != null)
    ) {
      eligible.push({ ...d, hit: d.carbG >= CARB_HIT_RATIO * d.carbTargetG });
    }
  }

  if (eligible.length === 0) reasonCodes.push("no_eligible_days");

  // Consolidated mapped metrics into a single pass to eliminate intermediate arrays
  const rpeDays: { hit: boolean; value: number }[] = [];
  const complianceDays: { hit: boolean; value: number }[] = [];
  for (const d of eligible) {
    if (d.avgRpe != null) rpeDays.push({ hit: d.hit, value: d.avgRpe });
    if (d.compliancePct != null) complianceDays.push({ hit: d.hit, value: d.compliancePct });
  }

  const rpe = compareMetric(rpeDays, round1, "insufficient_rpe_days", reasonCodes);
  const compliance = compareMetric(
    complianceDays,
    Math.round,
    "insufficient_compliance_days",
    reasonCodes,
  );

  const status = rpe || compliance ? "ok" : "insufficient_data";
  return {
    status,
    rpe,
    compliance,
    eligibleDays: eligible.length,
    carbHitPct: Math.round(CARB_HIT_RATIO * 100),
    reasonCodes,
    explanation:
      `Compares training days where you reached at least ${Math.round(CARB_HIT_RATIO * 100)}% of ` +
      `your carb target with days you didn't (minimum ${MIN_DAYS_PER_BUCKET} days per group). ` +
      `An association, not causation — guidance only.`,
  };
}

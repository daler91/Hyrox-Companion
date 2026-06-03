/**
 * Percentile ranking for a predicted HYROX finish time, against the real field.
 *
 * Consumes the server-only generated CDF artifact (raceRankingData.generated.ts)
 * so the large per-cohort percentile tables never reach the client bundle — only
 * the computed rank (a number + cohort metadata) ships in the API response.
 */
import { cohortKey, type Division, type Gender } from "@shared/raceConstants";

import { RACE_RANKINGS } from "./raceRankingData.generated";

export interface CohortRanking {
  /** Percent of the cohort the athlete's predicted finish would beat (1..99). */
  fasterThanPct: number;
  /** Number of real results in the cohort the rank was computed against. */
  cohortSize: number;
  /** Whether an age-specific cohort or the division×gender cohort was used. */
  basis: "age_group" | "division_gender";
  /** Age band actually used, or null when ranked against all ages. */
  ageGroup: string | null;
}

/**
 * Percentile rank (1..99) of `value` within an ascending p1..p99 table, where
 * `arr[i]` is the finish time at percentile (i + 1). Linearly interpolated and
 * clamped at the table ends, so an out-of-range prediction never throws.
 */
function percentileForValue(arr: number[], value: number): number {
  const n = arr.length;
  if (n === 0) return 50;
  if (value <= arr[0]) return 1;
  if (value >= arr[n - 1]) return n;
  for (let i = 1; i < n; i++) {
    if (value <= arr[i]) {
      const lo = arr[i - 1];
      const hi = arr[i];
      const frac = hi > lo ? (value - lo) / (hi - lo) : 0;
      return i + frac;
    }
  }
  return n;
}

/**
 * Rank a predicted finish against the athlete's cohort, preferring an
 * age-specific cohort and falling back to division×gender. Returns null when no
 * cohort exists (e.g. gender withheld, so no gendered field to compare against).
 * Lower finish time → faster → beats a larger share of the field.
 */
export function computeRanking(
  division: Division,
  gender: Gender,
  ageGroup: string | null,
  totalSeconds: number,
): CohortRanking | null {
  let basis: "age_group" | "division_gender" = "division_gender";
  let usedAge: string | null = null;
  let cdf = ageGroup ? RACE_RANKINGS[cohortKey(division, gender, ageGroup)] : undefined;
  if (cdf) {
    basis = "age_group";
    usedAge = ageGroup;
  } else {
    cdf = RACE_RANKINGS[cohortKey(division, gender)];
  }
  if (!cdf) return null;

  const pct = percentileForValue(cdf.finishSecondsByPercentile, totalSeconds);
  return {
    fasterThanPct: Math.min(99, Math.max(1, Math.round(100 - pct))),
    cohortSize: cdf.sampleSize,
    basis,
    ageGroup: usedAge,
  };
}

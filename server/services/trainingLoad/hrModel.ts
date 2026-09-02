// Training load: heart-rate and power physiology (audit A7: split out of
// trainingLoadService.ts).
//
// Max HR, Karvonen heart-rate reserve, HR zones, estimated LTHR, the objective
// intensity factors and the display-only hrTSS / power TSS.
//
// CALIBRATION COUPLING. The intensity factor produced here feeds the cardio
// stress score (stressScores.ts) and so the UTSS that every downstream threshold
// is read against: the ACWR zones in loadDynamics.ts, the vector restriction
// thresholds in trainingLoadService.ts and the governor's own gates in
// trainingLoadGovernor.ts. It must stay inside the same 0.6 to 2.6 band the RPE
// branch produces. Do not retune the HR model without retuning those
// thresholds, and do not move a threshold without checking what the HR model
// now scores against it.

import type { HrZone, HrZoneBoundary } from "@shared/schema";

import type { AthleteLoadContext } from "./types";
import { round } from "./utils";

// ── Objective cardio load (heart rate / power) ───────────────────────────────
// When a workout carries HR or power data we derive the cardio intensity factor
// from that objective signal instead of RPE/keywords. The factor stays in the
// SAME 0.6–2.6 band the RPE branch produces (RPE uses 0.6 + (rpe/10)²·2), so
// UTSS magnitudes — and every governor threshold calibrated to them — keep the
// same scale. hrTSS / power TSS are computed separately for display only
// (hrTss / powerTss) and never feed UTSS.
const DEFAULT_HR_REST = 60;
const DEFAULT_HR_MAX = 190;
const MAX_CARDIO_INTENSITY_FACTOR = 2.6;

// Tanaka 2001 age-predicted max HR, falling back to a flat default when age is
// unknown.
export function estimateHrMax(age?: number | null): number {
  return age && age > 0 ? Math.round(208 - 0.7 * age) : DEFAULT_HR_MAX;
}

/**
 * The athlete's max HR and where it came from.
 *
 * `DEFAULT_HR_MAX` (190) is the Tanaka prediction for a 26-year-old. Applying
 * it to an athlete whose age we do not know is not a small approximation: a
 * 52-year-old's predicted max is 172, so their threshold run scored 69.2% of
 * heart-rate reserve instead of the true 82.3% and was classified as easy
 * aerobic Z2 (audit H3). `users.age` is only ever written by the OPTIONAL
 * nutrition onboarding step, so skipping a nutrition screen silently corrupted
 * every heart-rate-derived number.
 */
function resolveHrMax(athlete?: AthleteLoadContext): {
  hrMax: number;
  basis: "measured" | "age_estimated" | "assumed";
} {
  if (athlete?.maxHr && athlete.maxHr > 0) return { hrMax: athlete.maxHr, basis: "measured" };
  if (athlete?.age && athlete.age > 0) {
    return { hrMax: estimateHrMax(athlete.age), basis: "age_estimated" };
  }
  return { hrMax: DEFAULT_HR_MAX, basis: "assumed" };
}

function resolveHrRest(athlete?: AthleteLoadContext): number {
  return athlete?.restingHr && athlete.restingHr > 0 ? athlete.restingHr : DEFAULT_HR_REST;
}

// Karvonen heart-rate reserve fraction in (0,1], or null when the inputs can't
// produce a meaningful value (no/low HR, max ≤ rest, or avg ≤ rest).
export function hrReserveRatio(
  avgHr: number | null | undefined,
  athlete?: AthleteLoadContext,
): number | null {
  const hr = Number(avgHr ?? 0);
  if (hr <= 0) return null;
  const hrRest = resolveHrRest(athlete);
  const { hrMax, basis } = resolveHrMax(athlete);
  // With neither a measured max nor an age there is no honest denominator, so
  // the HR signal is WITHHELD rather than computed against a 26-year-old's
  // predicted max (audit H3). Callers fall through to the RPE the athlete
  // actually gave, which is a real observation rather than a guess.
  if (basis === "assumed") return null;
  if (hrMax <= hrRest) return null;
  const ratio = (hr - hrRest) / (hrMax - hrRest);
  if (ratio <= 0) return null;
  return Math.min(1, ratio);
}

// Map a normalized cardio intensity (HR-reserve fraction or power %FTP) into the
// app's 0.6–2.6 band using the same quadratic shape as the RPE branch, so easy
// aerobic work scores low and threshold/max work approaches the ceiling.
function intensityFactorFromFraction(fraction: number): number {
  const f = Math.max(0, fraction);
  return round(Math.min(MAX_CARDIO_INTENSITY_FACTOR, 0.6 + f * f * 2), 2);
}

export function hrIntensityFactor(hrr: number): number {
  return intensityFactorFromFraction(hrr);
}

// Power-based intensity factor from %FTP (avgWatts / FTP). Null without usable
// FTP + watts. Above-threshold efforts clamp at the band ceiling.
export function powerIntensityFactor(
  avgWatts: number | null | undefined,
  ftp: number | null | undefined,
): number | null {
  const watts = Number(avgWatts ?? 0);
  const threshold = Number(ftp ?? 0);
  if (watts <= 0 || threshold <= 0) return null;
  return intensityFactorFromFraction(watts / threshold);
}

// ── HR zones, LTHR & hrTSS (display-only objective load) ─────────────────────
// Zones use the SAME Karvonen HRR axis as hrReserveRatio / hrIntensityFactor, so
// the zone label, intensity factor and hrTSS stay mutually consistent. With only
// average HR we classify a session into a SINGLE zone (NOT time-in-zone) and
// derive an hrTSS on the 100-pt TSS scale anchored on an estimated LTHR.

// Karvonen %HRR lower bounds for Z1..Z5.
const HR_ZONE_FLOORS = [0, 0.6, 0.7, 0.8, 0.9] as const;
const HR_ZONES: readonly HrZone[] = ["z1", "z2", "z3", "z4", "z5"];

export function hrZoneRank(zone: HrZone): number {
  return HR_ZONES.indexOf(zone);
}

// Estimated lactate-threshold HR. No schema field — derived from (estimated) max
// HR at ~88% HRmax, the common no-field-test heuristic. Floored strictly above
// resting HR so the hrTSS denominator (LTHR − rest) is always positive.
export function estimateLthr(athlete?: AthleteLoadContext): number {
  const { hrMax } = resolveHrMax(athlete);
  const hrRest = resolveHrRest(athlete);
  return Math.max(Math.round(0.88 * hrMax), hrRest + 1);
}

// bpm boundaries for the five Karvonen %HRR zones from resolved rest/max HR.
// Z1.minHr == resting HR, Z5.maxHr == max HR.
export function hrZoneBoundaries(athlete?: AthleteLoadContext): HrZoneBoundary[] {
  const hrRest = resolveHrRest(athlete);
  const { hrMax, basis } = resolveHrMax(athlete);
  // No measured max and no age means no honest zone table. Rendering one built
  // on a 26-year-old's predicted max told a 52-year-old their threshold effort
  // was easy aerobic work (audit H3); an empty table shows nothing instead.
  if (basis === "assumed") return [];
  // Same guard `hrReserveRatio` already applies. Without it, a resting HR entered
  // above max produced a negative reserve and an inverted zone table rendered as
  // fact; an empty table correctly shows nothing instead (audit L8).
  if (hrMax <= hrRest) return [];
  const reserve = hrMax - hrRest;
  return HR_ZONES.map((zone, i) => {
    const minHrr = HR_ZONE_FLOORS[i];
    const maxHrr = i < HR_ZONE_FLOORS.length - 1 ? HR_ZONE_FLOORS[i + 1] : 1;
    return {
      zone,
      minHrr,
      minHr: Math.round(hrRest + minHrr * reserve),
      maxHr: Math.round(hrRest + maxHrr * reserve),
    };
  });
}

// Single per-session Karvonen %HRR zone from average HR — NOT time-in-zone
// (averages only). Null when HR is unusable (same guards as hrReserveRatio).
export function classifyHrZone(
  avgHr: number | null | undefined,
  athlete?: AthleteLoadContext,
): HrZone | null {
  const hrr = hrReserveRatio(avgHr, athlete);
  if (hrr == null) return null;
  if (hrr < 0.6) return "z1";
  if (hrr < 0.7) return "z2";
  if (hrr < 0.8) return "z3";
  if (hrr < 0.9) return "z4";
  return "z5";
}

// hrTSS — display-only objective internal load on the 100-pt TSS scale, parallel
// to powerTss (NOT added to UTSS). IF_hr is the LTHR-reserve fraction clamped to
// [0,1]; IF_hr = 1.0 exactly when avgHr == LTHR. Average HR above threshold caps
// at 1.0 — a deliberate averages-only choice. Null without usable HR + duration.
export function hrTss(
  durationMin: number | null | undefined,
  avgHr: number | null | undefined,
  athlete?: AthleteLoadContext,
): number | null {
  const duration = Number(durationMin ?? 0);
  const hr = Number(avgHr ?? 0);
  if (duration <= 0 || hr <= 0) return null;
  const hrRest = resolveHrRest(athlete);
  const lthr = estimateLthr(athlete);
  if (lthr <= hrRest) return null;
  const intensity = Math.max(0, Math.min(1, (hr - hrRest) / (lthr - hrRest)));
  if (intensity <= 0) return null;
  return round((duration / 60) * intensity * intensity * 100, 1);
}

// Simplified power TSS — display-only (NOT added to UTSS). With only average
// power available, normalized power ≈ avgWatts, so
// TSS ≈ (minutes/60) · (avgWatts/FTP)² · 100. Null without FTP + watts.
export function powerTss(
  durationMin: number | null | undefined,
  avgWatts: number | null | undefined,
  ftp: number | null | undefined,
): number | null {
  const duration = Number(durationMin ?? 0);
  const watts = Number(avgWatts ?? 0);
  const threshold = Number(ftp ?? 0);
  if (duration <= 0 || watts <= 0 || threshold <= 0) return null;
  const intensity = watts / threshold;
  return round((duration / 60) * intensity * intensity * 100, 1);
}

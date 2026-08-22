/**
 * Derive a personalized running-pace multiplier from the athlete's recent run logs,
 * grounded to the generic defaults so it never produces an extreme session duration.
 * Feeds `estimatePlannedSession({ runPaceRatio })`: <1 = the athlete runs faster than
 * the generic defaults, >1 = slower. Returns 1 (pure generic) when there isn't enough
 * recent running to trust a personalized pace.
 */

import {
  GENERIC_RUN_PACE_SEC_PER_M,
  MAX_RUN_PACE_RATIO,
  MAX_RUN_PACE_RATIO_EVIDENCED,
  MIN_RUN_PACE_RATIO,
} from "@shared/plannedSessionEstimate";
import type { WorkoutLog } from "@shared/schema";

import { storage } from "../../storage";

const LOOKBACK_DAYS = 70; // ~10 weeks of recent running to anchor the athlete's pace
const MIN_SAMPLES = 3; // need a few runs before trusting a personalized ratio
// Enough of the athlete's own running to widen the clamp past the generic band.
const WELL_EVIDENCED_SAMPLES = 8;
// Strava/Garmin set a log's focus to the sport type (e.g. "Run", "TrailRun").
const RUN_FOCUS = /run/i;
// Plausible running speeds (m/s): ~1.1 ≈ 15:09/km … ~6.5 ≈ 2:34/km (elite).
//
// The floor was 1.8 (≈9:15/km), which is faster than plenty of people genuinely
// run. The stated purpose of this filter is removing mis-tagged cycling — and
// cycling is FAST, so the ceiling does that job; the floor was only discarding
// slow runners. A beginner at 9:30/km had every run dropped here, so they never
// reached MIN_SAMPLES and were permanently stuck on the generic pace, with more
// logging making no difference (audit M4).
const MIN_RUN_SPEED_MS = 1.1;
const MAX_RUN_SPEED_MS = 6.5;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Seconds per meter for a run log, from avgSpeed when present, else distance/duration. */
function logSecPerMeter(log: WorkoutLog): number | null {
  const distanceMeters = log.distanceMeters ?? 0;
  let speed: number | null = null;
  if (log.avgSpeed && log.avgSpeed > 0) {
    speed = log.avgSpeed;
  } else if (distanceMeters > 0 && log.duration && log.duration > 0) {
    speed = distanceMeters / (log.duration * 60); // duration is minutes app-wide
  }
  if (speed == null || speed < MIN_RUN_SPEED_MS || speed > MAX_RUN_SPEED_MS) return null;
  return 1 / speed;
}

export async function getRunPaceRatio(userId: string): Promise<number> {
  const from = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  let logs: WorkoutLog[];
  try {
    logs = await storage.analytics.getWorkoutLogsByDateRange(userId, from);
  } catch {
    return 1; // pace history is a nicety — a failed read must not break the estimate
  }

  const paces = logs
    .filter((l) => RUN_FOCUS.test(l.focus ?? ""))
    .map(logSecPerMeter)
    .filter((p): p is number => p != null);
  if (paces.length < MIN_SAMPLES) return 1;

  const ratio = median(paces) / GENERIC_RUN_PACE_SEC_PER_M;
  // A handful of runs stays grounded to the generic band; a real body of
  // evidence is allowed to say the athlete is simply slower than generic.
  const ceiling =
    paces.length >= WELL_EVIDENCED_SAMPLES ? MAX_RUN_PACE_RATIO_EVIDENCED : MAX_RUN_PACE_RATIO;
  return clamp(ratio, MIN_RUN_PACE_RATIO, ceiling);
}

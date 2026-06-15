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
  MIN_RUN_PACE_RATIO,
} from "@shared/plannedSessionEstimate";
import type { WorkoutLog } from "@shared/schema";

import { storage } from "../../storage";

const LOOKBACK_DAYS = 70; // ~10 weeks of recent running to anchor the athlete's pace
const MIN_SAMPLES = 3; // need a few runs before trusting a personalized ratio
// Strava/Garmin set a log's focus to the sport type (e.g. "Run", "TrailRun").
const RUN_FOCUS = /run/i;
// Plausible running speeds (m/s): ~1.8 ≈ 9:15/km (slow jog) … ~6.5 ≈ 2:34/km (elite).
// Filters out mis-tagged cycling/other cardio that would otherwise skew the median.
const MIN_RUN_SPEED_MS = 1.8;
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
  return clamp(ratio, MIN_RUN_PACE_RATIO, MAX_RUN_PACE_RATIO);
}

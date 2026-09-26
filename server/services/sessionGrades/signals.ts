/**
 * Reading the stored 15 s buckets: per-bucket speed and HR, and time-weighted
 * sums over a set of buckets. Shared by the easy and threshold graders so the
 * two measure a run the same way.
 */
import type { SessionStreamSamples } from "@shared/schema/sessionStream";

import { MAX_RUN_SPEED_MS, MIN_MOVING_S_FOR_SPEED, MIN_RUN_SPEED_MS } from "./constants";

/** m/s for a bucket, or null when it barely moved or the speed is not a run's. */
export function bucketSpeed(samples: SessionStreamSamples, i: number): number | null {
  const moving = samples.mov.at(i) ?? 0;
  const metres = samples.dist.at(i) ?? 0;
  if (!samples.has.distance || moving < MIN_MOVING_S_FOR_SPEED || metres <= 0) return null;
  const speed = metres / moving;
  return speed >= MIN_RUN_SPEED_MS && speed <= MAX_RUN_SPEED_MS ? speed : null;
}

export function bucketHr(samples: SessionStreamSamples, i: number): number | null {
  const moving = samples.mov.at(i) ?? 0;
  if (!samples.has.hr || moving <= 0) return null;
  return samples.hr.at(i) ?? null;
}

/** Indices of buckets with any movement. */
export function movingBuckets(samples: SessionStreamSamples): number[] {
  const out: number[] = [];
  samples.mov.forEach((seconds, i) => {
    if (seconds > 0) out.push(i);
  });
  return out;
}

export function movingSeconds(samples: SessionStreamSamples, buckets: readonly number[]): number {
  return buckets.reduce((sum, i) => sum + (samples.mov.at(i) ?? 0), 0);
}

export interface HrSummary {
  /** Time-weighted mean HR, or null without HR. */
  avg: number | null;
  /** Moving seconds that carried HR. */
  seconds: number;
}

export function hrOver(samples: SessionStreamSamples, buckets: readonly number[]): HrSummary {
  let weighted = 0;
  let seconds = 0;
  for (const i of buckets) {
    const hr = bucketHr(samples, i);
    if (hr === null) continue;
    const dt = samples.mov.at(i) ?? 0;
    weighted += hr * dt;
    seconds += dt;
  }
  return { avg: seconds > 0 ? weighted / seconds : null, seconds };
}

/** Moving seconds with HR matching `predicate`, and the moving seconds that had HR at all. */
export function hrShare(
  samples: SessionStreamSamples,
  buckets: readonly number[],
  predicate: (hr: number) => boolean,
): { matched: number; total: number } {
  let matched = 0;
  let total = 0;
  for (const i of buckets) {
    const hr = bucketHr(samples, i);
    if (hr === null) continue;
    const dt = samples.mov.at(i) ?? 0;
    total += dt;
    if (predicate(hr)) matched += dt;
  }
  return { matched, total };
}

/** Seconds per km over the buckets (total distance over total moving time), or null. */
export function paceOver(samples: SessionStreamSamples, buckets: readonly number[]): number | null {
  let metres = 0;
  let seconds = 0;
  for (const i of buckets) {
    if (bucketSpeed(samples, i) === null) continue;
    metres += samples.dist.at(i) ?? 0;
    seconds += samples.mov.at(i) ?? 0;
  }
  return metres > 0 ? (seconds / metres) * 1000 : null;
}

/** Moving seconds whose pace is faster than `secondsPerKm`, and the moving seconds that had a pace. */
export function fasterThanShare(
  samples: SessionStreamSamples,
  buckets: readonly number[],
  secondsPerKm: number,
): { matched: number; total: number } {
  const speedCut = 1000 / secondsPerKm;
  let matched = 0;
  let total = 0;
  for (const i of buckets) {
    const speed = bucketSpeed(samples, i);
    if (speed === null) continue;
    const dt = samples.mov.at(i) ?? 0;
    total += dt;
    if (speed > speedCut) matched += dt;
  }
  return { matched, total };
}

/** Split buckets into consecutive chunks of roughly equal moving time. */
export function splitByMovingTime(
  samples: SessionStreamSamples,
  buckets: readonly number[],
  parts: number,
): number[][] {
  const total = movingSeconds(samples, buckets);
  const chunks: number[][] = Array.from({ length: parts }, () => []);
  let elapsed = 0;
  for (const i of buckets) {
    const part = Math.min(parts - 1, Math.floor((elapsed / Math.max(1, total)) * parts));
    chunks.at(part)?.push(i);
    elapsed += samples.mov.at(i) ?? 0;
  }
  return chunks;
}

export function roundTo(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function pct(part: number, whole: number): number | null {
  return whole > 0 ? roundTo((part / whole) * 100, 0) : null;
}

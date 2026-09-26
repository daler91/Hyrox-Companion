/**
 * Find the work inside a threshold session.
 *
 * A threshold run is mostly not threshold: fifteen minutes easy, the reps,
 * jogs between them, ten minutes easy. Whole-run averages bury the work, and
 * the athlete's watch laps every mile, which cuts across reps. So the work is
 * found in the stream itself: smooth the speed (or HR, on a treadmill), split
 * the run into a faster and a slower group with Otsu's method, and keep the
 * stretches of the faster group long enough to be reps.
 *
 * When the run does not split into two groups — a continuous tempo with no
 * warm-up, or a run that stayed easy throughout — the run minus a warm-up and
 * cool-down margin is graded as one block instead, so "you never got to
 * threshold" is still an answer.
 */
import type { SessionStreamSamples } from "@shared/schema/sessionStream";

import {
  CONTINUOUS_COOLDOWN_S,
  CONTINUOUS_MIN_S,
  CONTINUOUS_WARMUP_S,
  MAX_DIP_BUCKETS,
  MAX_HIGH_CLUSTER_SHARE,
  MIN_HIGH_CLUSTER_SHARE,
  MIN_SEPARATION_HR_BPM,
  MIN_SEPARATION_SPEED_RATIO,
  MIN_SIGNAL_COVERAGE,
  MIN_WORK_SEGMENT_S,
  SMOOTH_WINDOW_BUCKETS,
} from "./constants";
import { bucketHr, bucketSpeed, movingBuckets, movingSeconds } from "./signals";

export type SegmentSignal = "speed" | "hr";

export interface Segmentation {
  kind: "reps" | "continuous" | "none";
  signal: SegmentSignal | null;
  /** Each segment's bucket indices, in order. */
  segments: number[][];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted.at(mid) ?? 0;
  return sorted.length % 2 === 0 ? ((sorted.at(mid - 1) ?? upper) + upper) / 2 : upper;
}

function chooseSignal(
  samples: SessionStreamSamples,
  moving: readonly number[],
  speedTrusted: boolean,
): SegmentSignal | null {
  if (moving.length === 0) return null;
  const coverage = (read: (i: number) => number | null) =>
    moving.filter((i) => read(i) !== null).length / moving.length;
  if (speedTrusted && coverage((i) => bucketSpeed(samples, i)) >= MIN_SIGNAL_COVERAGE) return "speed";
  if (coverage((i) => bucketHr(samples, i)) >= MIN_SIGNAL_COVERAGE) return "hr";
  return null;
}

/** Rolling median over neighbouring buckets, which strips GPS spikes without blurring rep edges. */
function smooth(raw: (number | null)[]): (number | null)[] {
  const half = Math.floor(SMOOTH_WINDOW_BUCKETS / 2);
  return raw.map((value, i) => {
    if (value === null) return null;
    const window: number[] = [];
    for (let j = i - half; j <= i + half; j++) {
      // at() would wrap a negative index round to the end of the run.
      const neighbour = j >= 0 ? raw.at(j) : undefined;
      if (neighbour != null) window.push(neighbour);
    }
    return median(window);
  });
}

/** Otsu's threshold: the cut that best separates the values into two groups. */
export function otsuCut(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  let lowSum = 0;
  let best: { score: number; cut: number } | null = null;
  for (let k = 1; k < sorted.length; k++) {
    const previous = sorted.at(k - 1) ?? 0;
    lowSum += previous;
    const current = sorted.at(k) ?? 0;
    if (current === previous) continue;
    const lowMean = lowSum / k;
    const highMean = (total - lowSum) / (sorted.length - k);
    const score = k * (sorted.length - k) * (highMean - lowMean) ** 2;
    if (!best || score > best.score) best = { score, cut: current };
  }
  return best?.cut ?? null;
}

function separated(signal: SegmentSignal, low: number[], high: number[], total: number): boolean {
  if (low.length === 0 || high.length === 0) return false;
  const share = high.length / total;
  if (share < MIN_HIGH_CLUSTER_SHARE || share > MAX_HIGH_CLUSTER_SHARE) return false;
  const lowMean = low.reduce((sum, value) => sum + value, 0) / low.length;
  const highMean = high.reduce((sum, value) => sum + value, 0) / high.length;
  return signal === "speed"
    ? highMean >= lowMean * MIN_SEPARATION_SPEED_RATIO
    : highMean - lowMean >= MIN_SEPARATION_HR_BPM;
}

function indexRange(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, k) => from + k);
}

/** Stretches of `high` buckets, bridging dips of up to MAX_DIP_BUCKETS (a crossing, a turn). */
function stretches(high: readonly boolean[]): number[][] {
  const runs: number[][] = [];
  let start = -1;
  let lastHigh = -1;
  for (const [i, isHigh] of high.entries()) {
    if (!isHigh) continue;
    if (start < 0) {
      start = i;
    } else if (i - lastHigh - 1 > MAX_DIP_BUCKETS) {
      runs.push(indexRange(start, lastHigh));
      start = i;
    }
    lastHigh = i;
  }
  if (start >= 0) runs.push(indexRange(start, lastHigh));
  return runs;
}

function findReps(
  samples: SessionStreamSamples,
  moving: readonly number[],
  signal: SegmentSignal,
): number[][] {
  const read = signal === "speed" ? bucketSpeed : bucketHr;
  const isMoving = new Set(moving);
  const raw = samples.mov.map((_, i) => (isMoving.has(i) ? read(samples, i) : null));
  const smoothed = smooth(raw);
  const values = smoothed.filter((value): value is number => value !== null);
  const cut = otsuCut(values);
  if (cut === null) return [];
  const high = values.filter((value) => value >= cut);
  const low = values.filter((value) => value < cut);
  if (!separated(signal, low, high, values.length)) return [];
  const isHigh = smoothed.map((value) => value !== null && value >= cut);
  return stretches(isHigh).filter((run) => movingSeconds(samples, run) >= MIN_WORK_SEGMENT_S);
}

/** The run minus a warm-up and cool-down margin, measured in moving time. */
function continuousBlock(samples: SessionStreamSamples, moving: readonly number[]): number[] | null {
  const total = movingSeconds(samples, moving);
  if (total < CONTINUOUS_MIN_S) return null;
  const block: number[] = [];
  let elapsed = 0;
  for (const i of moving) {
    const dt = samples.mov.at(i) ?? 0;
    if (elapsed >= CONTINUOUS_WARMUP_S && elapsed + dt <= total - CONTINUOUS_COOLDOWN_S) block.push(i);
    elapsed += dt;
  }
  return movingSeconds(samples, block) >= MIN_WORK_SEGMENT_S ? block : null;
}

export function findWorkSegments(samples: SessionStreamSamples, opts: { speedTrusted: boolean }): Segmentation {
  const moving = movingBuckets(samples);
  const signal = chooseSignal(samples, moving, opts.speedTrusted);
  if (signal) {
    const reps = findReps(samples, moving, signal);
    if (reps.length > 0) return { kind: "reps", signal, segments: reps };
  }
  const block = continuousBlock(samples, moving);
  if (block) return { kind: "continuous", signal, segments: [block] };
  return { kind: "none", signal, segments: [] };
}

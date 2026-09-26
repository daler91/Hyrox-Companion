/**
 * Fold a Strava activity stream into the compact buckets session grading
 * keeps (`workout_log_streams.samples`).
 *
 * Strava returns one value per recorded sample — every second on most
 * watches, but irregularly under "smart recording", with gaps where the
 * watch was paused. So nothing here assumes 1 Hz: every sum is weighted by
 * the time the sample actually covered (`dt`), and an implausibly long gap
 * is a pause that contributes nothing rather than one sample stretched over
 * minutes.
 */
import {
  SESSION_STREAM_SAMPLES_VERSION,
  type SessionStreamSamples,
} from "@shared/schema/sessionStream";

import {
  BUCKET_SECONDS,
  HR_MAX_BPM,
  HR_MIN_BPM,
  MAX_BUCKETS,
  MAX_SAMPLE_GAP_S,
  MIN_HR_COVERAGE,
  MIN_HR_SECONDS_PER_BUCKET,
  MIN_MOVING_SECONDS,
  MOVING_SPEED_MS,
} from "./constants";

/** The series we request from Strava, as flat arrays (see `parseStravaStreamResponse`). */
export interface StravaStreamSet {
  time?: number[];
  heartrate?: number[];
  velocity_smooth?: number[];
  distance?: number[];
  moving?: boolean[];
}

export type DownsampleStatus = "ok" | "no_heartrate" | "unavailable";

export interface DownsampleResult {
  status: DownsampleStatus;
  samples: SessionStreamSamples | null;
}

function seriesData(entry: unknown): unknown[] | null {
  if (typeof entry !== "object" || entry === null) return null;
  const data = (entry as { data?: unknown }).data;
  return Array.isArray(data) ? data : null;
}

function numberSeries(entry: unknown): number[] | undefined {
  const data = seriesData(entry);
  return data?.every((value): value is number => typeof value === "number" && Number.isFinite(value))
    ? data
    : undefined;
}

function booleanSeries(entry: unknown): boolean[] | undefined {
  const data = seriesData(entry);
  return data?.every((value): value is boolean => typeof value === "boolean") ? data : undefined;
}

interface StravaStreamBody {
  time?: unknown;
  heartrate?: unknown;
  velocity_smooth?: unknown;
  distance?: unknown;
  moving?: unknown;
}

/**
 * Strava's `key_by_type=true` body is `{ time: { data: [...] }, heartrate:
 * { data: [...] }, ... }`. Keep only well-formed arrays of the right type so
 * the downsampler never sees a surprise shape. Each series is read by name,
 * never through a computed key.
 */
export function parseStravaStreamResponse(body: unknown): StravaStreamSet {
  if (typeof body !== "object" || body === null) return {};
  const record = body as StravaStreamBody;
  const set: StravaStreamSet = {};
  const time = numberSeries(record.time);
  const heartrate = numberSeries(record.heartrate);
  const velocity = numberSeries(record.velocity_smooth);
  const distance = numberSeries(record.distance);
  const moving = booleanSeries(record.moving);
  if (time) set.time = time;
  if (heartrate) set.heartrate = heartrate;
  if (velocity) set.velocity_smooth = velocity;
  if (distance) set.distance = distance;
  if (moving) set.moving = moving;
  return set;
}

/** A series is only trusted when it lines up sample for sample with `time`. */
function aligned<T>(series: T[] | undefined, length: number): T[] | undefined {
  return series && series.length === length ? series : undefined;
}

/** One bucket's running sums. */
interface BucketSums {
  hrWeighted: number;
  hrSeconds: number;
  dist: number;
  mov: number;
}

interface AlignedStreams {
  time: number[];
  heartrate: number[] | undefined;
  velocity: number[] | undefined;
  distance: number[] | undefined;
  moving: boolean[] | undefined;
}

/** Whether sample `i` was moving: Strava's own flag, else speed, else assume so. */
function isMovingAt(streams: AlignedStreams, i: number): boolean {
  if (streams.moving) return streams.moving.at(i) === true;
  if (streams.velocity) return (streams.velocity.at(i) ?? 0) > MOVING_SPEED_MS;
  return true;
}

/** Metres covered by sample `i`: the distance stream's step, else speed × time. */
function metresAt(streams: AlignedStreams, i: number, dt: number): number {
  if (streams.distance) return Math.max(0, (streams.distance.at(i) ?? 0) - (streams.distance.at(i - 1) ?? 0));
  const speed = streams.velocity?.at(i);
  return speed === undefined ? 0 : Math.max(0, speed * dt);
}

interface Totals {
  buckets: BucketSums[];
  truncated: boolean;
  movingSeconds: number;
  hrMovingSeconds: number;
  hasDistance: boolean;
}

function accumulate(streams: AlignedStreams, bucketCount: number): Totals {
  const { time } = streams;
  const start = time.at(0) ?? 0;
  const totals: Totals = {
    buckets: Array.from({ length: bucketCount }, () => ({ hrWeighted: 0, hrSeconds: 0, dist: 0, mov: 0 })),
    truncated: false,
    movingSeconds: 0,
    hrMovingSeconds: 0,
    hasDistance: false,
  };
  for (let i = 1; i < time.length; i++) {
    const prev = time.at(i - 1) ?? 0;
    const dt = (time.at(i) ?? 0) - prev;
    // Out-of-order samples and pauses add nothing.
    if (dt <= 0 || dt > MAX_SAMPLE_GAP_S) continue;
    const bucket = totals.buckets.at(Math.floor((prev - start) / BUCKET_SECONDS));
    if (!bucket) {
      totals.truncated = true;
      break;
    }
    if (!isMovingAt(streams, i)) continue;
    bucket.mov += dt;
    totals.movingSeconds += dt;

    const metres = metresAt(streams, i, dt);
    if (metres > 0) totals.hasDistance = true;
    bucket.dist += metres;

    const hr = streams.heartrate?.at(i);
    if (hr !== undefined && hr >= HR_MIN_BPM && hr <= HR_MAX_BPM) {
      bucket.hrWeighted += hr * dt;
      bucket.hrSeconds += dt;
      totals.hrMovingSeconds += dt;
    }
  }
  return totals;
}

export function downsampleStravaStreams(set: StravaStreamSet): DownsampleResult {
  const time = set.time;
  if (!time || time.length < 2) return { status: "unavailable", samples: null };
  const streams: AlignedStreams = {
    time,
    heartrate: aligned(set.heartrate, time.length),
    velocity: aligned(set.velocity_smooth, time.length),
    distance: aligned(set.distance, time.length),
    moving: aligned(set.moving, time.length),
  };

  const elapsedSeconds = Math.max(0, (time.at(-1) ?? 0) - (time.at(0) ?? 0));
  const bucketCount = Math.min(MAX_BUCKETS, Math.floor(elapsedSeconds / BUCKET_SECONDS) + 1);
  const totals = accumulate(streams, bucketCount);
  const truncated = totals.truncated || elapsedSeconds >= MAX_BUCKETS * BUCKET_SECONDS;

  if (totals.movingSeconds < MIN_MOVING_SECONDS) return { status: "unavailable", samples: null };
  const hasHr = totals.hrMovingSeconds >= totals.movingSeconds * MIN_HR_COVERAGE;
  if (!hasHr && !totals.hasDistance) return { status: "unavailable", samples: null };

  const samples: SessionStreamSamples = {
    v: SESSION_STREAM_SAMPLES_VERSION,
    bucketSeconds: BUCKET_SECONDS,
    hr: totals.buckets.map((bucket) =>
      hasHr && bucket.hrSeconds >= MIN_HR_SECONDS_PER_BUCKET ? Math.round(bucket.hrWeighted / bucket.hrSeconds) : null,
    ),
    dist: totals.buckets.map((bucket) => Math.round(bucket.dist)),
    mov: totals.buckets.map((bucket) => Math.round(bucket.mov)),
    has: { hr: hasHr, distance: totals.hasDistance },
    elapsedSeconds: Math.round(elapsedSeconds),
    truncated,
  };
  return { status: hasHr ? "ok" : "no_heartrate", samples };
}

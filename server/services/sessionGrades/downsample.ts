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

const STREAM_KEYS = ["time", "heartrate", "velocity_smooth", "distance", "moving"] as const;

/**
 * Strava's `key_by_type=true` body is `{ time: { data: [...] }, heartrate:
 * { data: [...] }, ... }`. Keep only well-formed arrays of the right type so
 * the downsampler never sees a surprise shape.
 */
export function parseStravaStreamResponse(body: unknown): StravaStreamSet {
  const set: StravaStreamSet = {};
  if (typeof body !== "object" || body === null) return set;
  const record = body as Record<string, unknown>;
  for (const key of STREAM_KEYS) {
    const entry = record[key];
    const data =
      typeof entry === "object" && entry !== null ? (entry as { data?: unknown }).data : undefined;
    if (!Array.isArray(data)) continue;
    if (key === "moving") {
      if (data.every((value): value is boolean => typeof value === "boolean")) set.moving = data;
    } else if (data.every((value): value is number => typeof value === "number" && Number.isFinite(value))) {
      set[key] = data;
    }
  }
  return set;
}

/** A series is only trusted when it lines up sample for sample with `time`. */
function aligned<T>(series: T[] | undefined, length: number): T[] | undefined {
  return series && series.length === length ? series : undefined;
}

interface Accumulator {
  hrWeighted: number[];
  hrSeconds: number[];
  dist: number[];
  mov: number[];
}

function emptyAccumulator(buckets: number): Accumulator {
  return {
    hrWeighted: new Array<number>(buckets).fill(0),
    hrSeconds: new Array<number>(buckets).fill(0),
    dist: new Array<number>(buckets).fill(0),
    mov: new Array<number>(buckets).fill(0),
  };
}

export function downsampleStravaStreams(set: StravaStreamSet): DownsampleResult {
  const time = set.time;
  if (!time || time.length < 2) return { status: "unavailable", samples: null };
  const length = time.length;
  const heartrate = aligned(set.heartrate, length);
  const velocity = aligned(set.velocity_smooth, length);
  const distance = aligned(set.distance, length);
  const moving = aligned(set.moving, length);

  const elapsedSeconds = Math.max(0, (time.at(-1) ?? 0) - (time[0] ?? 0));
  const start = time[0] ?? 0;
  const bucketCount = Math.min(MAX_BUCKETS, Math.floor(elapsedSeconds / BUCKET_SECONDS) + 1);
  const acc = emptyAccumulator(bucketCount);
  let truncated = false;
  let movingSeconds = 0;
  let hrMovingSeconds = 0;
  let hasDistance = false;

  for (let i = 1; i < length; i++) {
    const prev = time[i - 1] ?? 0;
    const dt = (time[i] ?? 0) - prev;
    // Out-of-order samples and pauses add nothing.
    if (dt <= 0 || dt > MAX_SAMPLE_GAP_S) continue;
    const bucket = Math.floor((prev - start) / BUCKET_SECONDS);
    if (bucket >= bucketCount) {
      truncated = true;
      break;
    }

    const speed = velocity?.[i];
    let isMoving = true;
    if (moving) isMoving = moving[i] === true;
    else if (velocity) isMoving = (speed ?? 0) > MOVING_SPEED_MS;
    if (!isMoving) continue;
    acc.mov[bucket] = (acc.mov[bucket] ?? 0) + dt;
    movingSeconds += dt;

    let metres = 0;
    if (distance) metres = Math.max(0, (distance[i] ?? 0) - (distance[i - 1] ?? 0));
    else if (speed !== undefined) metres = Math.max(0, speed * dt);
    if (metres > 0) hasDistance = true;
    acc.dist[bucket] = (acc.dist[bucket] ?? 0) + metres;

    const hr = heartrate?.[i];
    if (hr !== undefined && hr >= HR_MIN_BPM && hr <= HR_MAX_BPM) {
      acc.hrWeighted[bucket] = (acc.hrWeighted[bucket] ?? 0) + hr * dt;
      acc.hrSeconds[bucket] = (acc.hrSeconds[bucket] ?? 0) + dt;
      hrMovingSeconds += dt;
    }
  }
  if (!truncated && elapsedSeconds >= MAX_BUCKETS * BUCKET_SECONDS) truncated = true;

  if (movingSeconds < MIN_MOVING_SECONDS) return { status: "unavailable", samples: null };
  const hasHr = hrMovingSeconds >= movingSeconds * MIN_HR_COVERAGE;
  if (!hasHr && !hasDistance) return { status: "unavailable", samples: null };

  const samples: SessionStreamSamples = {
    v: SESSION_STREAM_SAMPLES_VERSION,
    bucketSeconds: BUCKET_SECONDS,
    hr: acc.hrSeconds.map((seconds, i) =>
      hasHr && seconds >= MIN_HR_SECONDS_PER_BUCKET
        ? Math.round((acc.hrWeighted[i] ?? 0) / seconds)
        : null,
    ),
    dist: acc.dist.map((metres) => Math.round(metres)),
    mov: acc.mov.map((seconds) => Math.round(seconds)),
    has: { hr: hasHr, distance: hasDistance },
    elapsedSeconds: Math.round(elapsedSeconds),
    truncated,
  };
  return { status: hasHr ? "ok" : "no_heartrate", samples };
}

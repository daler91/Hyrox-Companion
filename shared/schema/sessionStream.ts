/**
 * The compact stream a graded run keeps (`workout_log_streams.samples`).
 *
 * A zero-import module (like deviceActivity.ts) so the table definition, the
 * server and the client can all name the shape without evaluating the drizzle
 * pgTable graph.
 *
 * Strava's raw stream is one sample a second — 3,600 per series for an hour.
 * Session grading needs neither that resolution nor GPS, so the fetch folds
 * it into fixed buckets (15 s by default): about 240 entries per series per
 * hour, ~3 KB of JSON. Grades are recomputed from these buckets on every read,
 * which is what lets a changed max HR re-grade old runs without a refetch.
 */

export const SESSION_STREAM_SAMPLES_VERSION = 1;

export interface SessionStreamSamples {
  v: typeof SESSION_STREAM_SAMPLES_VERSION;
  /** Width of every bucket, seconds of elapsed time. */
  bucketSeconds: number;
  /** Time-weighted mean heart rate per bucket; null where under 5 s of HR was recorded. */
  hr: (number | null)[];
  /** Metres covered while moving, per bucket (integer). */
  dist: number[];
  /** Seconds spent moving, per bucket (0..bucketSeconds). */
  mov: number[];
  /** Which signals the recording actually carried. */
  has: { hr: boolean; distance: boolean };
  /** Elapsed seconds the stream covered (before any cap). */
  elapsedSeconds: number;
  /** True when the stream ran past the bucket cap and the tail was dropped. */
  truncated: boolean;
}

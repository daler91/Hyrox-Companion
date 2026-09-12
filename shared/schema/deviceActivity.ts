/**
 * Device activity snapshot types.
 *
 * A zero-import module (like enums.ts) so the table definition, the server
 * and the client can all name these shapes without evaluating the drizzle
 * pgTable graph.
 */

/**
 * The fields of a Strava SummaryActivity (the `/athlete/activities` list row)
 * that the app reads. Optional fields are absent on activities recorded
 * without the relevant sensor.
 */
export interface StravaActivitySummary {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  /** UTC ISO instant. */
  start_date: string;
  /** The athlete's local wall-clock time, Z-suffixed by Strava. */
  start_date_local: string;
  /** Metres. */
  distance: number;
  /** Seconds. */
  moving_time: number;
  /** Seconds. */
  elapsed_time: number;
  total_elevation_gain: number;
  average_speed: number;
  max_speed: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  average_watts?: number;
  kilojoules?: number;
  calories?: number;
  suffer_score?: number;
  pr_count?: number;
  achievement_count?: number;
}

export type DeviceActivityProvider = "strava";

/**
 * What `workout_logs.device_activity` stores: the raw provider row as it
 * arrived, plus the metric columns the link filled on the workout row, so an
 * unlink can NULL exactly those columns and re-create the activity as its own
 * row without a second API call.
 */
export interface DeviceActivitySnapshot {
  provider: DeviceActivityProvider;
  raw: StravaActivitySummary;
  /** workout_logs column names (camelCase) the link wrote because they were NULL. */
  filledColumns: string[];
  /** ISO instant the snapshot was taken. */
  linkedAt: string;
}

/**
 * Seconds the recording's clock ran while the athlete was not moving, or null
 * when the recording cannot say.
 *
 * `workout_logs.duration` is MOVING time (see the column note in tables.ts),
 * which is the right measure for load and pace but makes a stop invisible: a
 * 16 km run with half an hour standing still reads exactly like one run
 * straight through. This is the difference the duration deliberately drops, so
 * a surface can show it rather than silently swallow it.
 *
 * Null when there is no snapshot to read, or when the provider reports one
 * clock for both (every non-GPS sport type does — Strava has no way to tell
 * moving from still without GPS, so it sets the two equal). Small positive
 * gaps are returned as they are; whether a gap is worth showing is the
 * display's judgement, not this function's.
 */
export function stoppedSecondsFor(
  snapshot: DeviceActivitySnapshot | null | undefined,
): number | null {
  const raw = snapshot?.raw;
  if (!raw) return null;
  const { moving_time: moving, elapsed_time: elapsed } = raw;
  if (!Number.isFinite(moving) || !Number.isFinite(elapsed)) return null;
  // Never negative: a provider that reports a moving time above its elapsed
  // time is describing something this cannot interpret, so report no stop
  // rather than a negative one.
  return Math.max(0, Math.round(elapsed - moving));
}

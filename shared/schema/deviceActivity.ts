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

import {
  type DistanceUnit,
  formatElevation,
  formatNumberWithUnit,
  formatPace as formatPaceShared,
  metersToUserDistance,
} from "@shared/unitConversion";

/**
 * Subset of @flow-js/garmin-connect's IActivity that we actually map. We
 * intentionally avoid importing IActivity directly because the library types
 * cover ~150 fields, most of which are typed as `unknown` and would only add
 * noise. The fields below are the stable ones that have been part of the
 * Garmin Connect API for years.
 */
export interface GarminActivity {
  activityId: number;
  activityName?: string;
  startTimeLocal: string; // "YYYY-MM-DD HH:mm:ss"
  startTimeGMT?: string;
  activityType?: {
    typeKey?: string;
  };
  distance?: number; // meters
  duration?: number; // seconds (total)
  movingDuration?: number; // seconds
  elevationGain?: number; // meters
  averageSpeed?: number; // m/s
  maxSpeed?: number; // m/s
  averageHR?: number; // bpm
  maxHR?: number; // bpm
  averageRunningCadenceInStepsPerMinute?: number;
  calories?: number;
  // Upstream IActivity types this as `unknown` because it can be missing for
  // non-power activities. We mirror that here so callers can pass IActivity
  // instances directly without an `as unknown` cast — the runtime type check
  // in the mapper handles the narrowing.
  avgPower?: unknown;
}

function formatGarminDistance(meters: number, distanceUnit: DistanceUnit): string {
  const converted = metersToUserDistance(meters, distanceUnit);
  const unitStr = distanceUnit === "miles" ? "mi" : "km";
  return formatNumberWithUnit(converted, unitStr, 2);
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatGarminPace(metersPerSecond: number, distanceUnit: DistanceUnit): string {
  if (metersPerSecond <= 0) return "";
  return formatPaceShared(metersPerSecond, distanceUnit);
}

/**
 * Garmin's startTimeLocal is "YYYY-MM-DD HH:mm:ss" — a naive local timestamp
 * with no timezone. We just want the date portion for the workout log row.
 */
function extractDate(startTimeLocal: string): string {
  // Defensive: some endpoints return ISO-8601 with a "T" separator instead.
  return startTimeLocal.split(/[ T]/)[0];
}

function buildMainWorkout(
  movingSec: number,
  distance: number,
  isDistanceActivity: boolean,
  distanceUnit: DistanceUnit,
): string {
  if (isDistanceActivity) {
    return `${formatGarminDistance(distance, distanceUnit)}, ${formatDuration(movingSec)}`;
  }
  return `${formatDuration(movingSec)} session`;
}

function buildAccessory(
  activity: GarminActivity,
  isDistanceActivity: boolean,
  distanceUnit: DistanceUnit,
): string | null {
  const parts: string[] = [];
  const elevation = activity.elevationGain ?? 0;
  if (elevation > 0) {
    parts.push(`Elevation: ${formatElevation(elevation, distanceUnit)}`);
  }
  const speed = activity.averageSpeed ?? 0;
  if (isDistanceActivity && speed > 0) {
    parts.push(`Pace: ${formatGarminPace(speed, distanceUnit)}`);
  }
  return parts.length > 0 ? parts.join(" | ") : null;
}

function buildHeartRateText(averageHR: number, maxHR?: number): string {
  const avg = Math.round(averageHR);
  if (maxHR) {
    return `Avg HR: ${avg} bpm (max ${Math.round(maxHR)})`;
  }
  return `Avg HR: ${avg} bpm`;
}

function buildNotes(activity: GarminActivity): string | null {
  const parts: string[] = [];
  if (activity.activityName) {
    parts.push(activity.activityName);
  }
  if (activity.averageHR) {
    parts.push(buildHeartRateText(activity.averageHR, activity.maxHR));
  }
  return parts.length > 0 ? parts.join(" | ") : null;
}

function roundOrNull(value: number | null | undefined): number | null {
  return value ? Math.round(value) : null;
}

/**
 * Maps a Garmin Connect activity into the same workoutLogs row shape Strava
 * uses. Source is set to "garmin" and garminActivityId is populated instead
 * of stravaActivityId.
 */
export function mapGarminActivityToWorkout(
  activity: GarminActivity,
  userId: string,
  distanceUnit: DistanceUnit = "km",
) {
  const movingSec = activity.movingDuration ?? activity.duration ?? 0;
  const distance = activity.distance ?? 0;
  const isDistanceActivity = distance > 100;

  // typeKey examples: "running", "indoor_running", "trail_running",
  // "strength_training", "indoor_cardio", "cycling", "lap_swimming". We
  // surface it raw in `focus` so the existing UI categorisation can match
  // on it the same way it does for Strava's sport_type.
  const focus = activity.activityType?.typeKey || "Workout";

  return {
    userId,
    date: extractDate(activity.startTimeLocal),
    focus,
    mainWorkout: buildMainWorkout(movingSec, distance, isDistanceActivity, distanceUnit),
    accessory: buildAccessory(activity, isDistanceActivity, distanceUnit),
    notes: buildNotes(activity),
    duration: Math.round(movingSec / 60),
    rpe: null,
    planDayId: null,
    source: "garmin" as const,
    garminActivityId: String(activity.activityId),
    calories: roundOrNull(activity.calories),
    distanceMeters: distance > 0 ? distance : null,
    elevationGain: activity.elevationGain ?? null,
    avgHeartrate: roundOrNull(activity.averageHR),
    maxHeartrate: roundOrNull(activity.maxHR),
    avgSpeed: activity.averageSpeed ?? null,
    maxSpeed: activity.maxSpeed ?? null,
    avgCadence: activity.averageRunningCadenceInStepsPerMinute ?? null,
    avgWatts: typeof activity.avgPower === "number" ? Math.round(activity.avgPower) : null,
    sufferScore: null, // Garmin doesn't expose Strava's "suffer score".
  };
}

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
  // avgPower is typed as `unknown` upstream because it can be missing for
  // non-power activities; we widen to number | null at the boundary.
  avgPower?: number | null;
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
  const durationMinutes = Math.round(movingSec / 60);
  const distance = activity.distance ?? 0;
  const isDistanceActivity = distance > 100;

  let mainWorkout: string;
  if (isDistanceActivity) {
    mainWorkout = `${formatGarminDistance(distance, distanceUnit)}, ${formatDuration(movingSec)}`;
  } else {
    mainWorkout = `${formatDuration(movingSec)} session`;
  }

  const accessoryParts: string[] = [];
  if ((activity.elevationGain ?? 0) > 0) {
    accessoryParts.push(`Elevation: ${formatElevation(activity.elevationGain as number, distanceUnit)}`);
  }
  if (isDistanceActivity && (activity.averageSpeed ?? 0) > 0) {
    accessoryParts.push(`Pace: ${formatGarminPace(activity.averageSpeed as number, distanceUnit)}`);
  }
  const accessory = accessoryParts.length > 0 ? accessoryParts.join(" | ") : null;

  const notesParts: string[] = [];
  if (activity.activityName) {
    notesParts.push(activity.activityName);
  }
  if (activity.averageHR) {
    const avg = Math.round(activity.averageHR);
    const hrText = activity.maxHR
      ? `Avg HR: ${avg} bpm (max ${Math.round(activity.maxHR)})`
      : `Avg HR: ${avg} bpm`;
    notesParts.push(hrText);
  }
  const notes = notesParts.length > 0 ? notesParts.join(" | ") : null;

  // typeKey examples: "running", "indoor_running", "trail_running",
  // "strength_training", "indoor_cardio", "cycling", "lap_swimming". We
  // surface it raw in `focus` so the existing UI categorisation can match
  // on it the same way it does for Strava's sport_type.
  const focus = activity.activityType?.typeKey || "Workout";

  return {
    userId,
    date: extractDate(activity.startTimeLocal),
    focus,
    mainWorkout,
    accessory,
    notes,
    duration: durationMinutes,
    rpe: null,
    planDayId: null,
    source: "garmin" as const,
    garminActivityId: String(activity.activityId),
    calories: activity.calories ? Math.round(activity.calories) : null,
    distanceMeters: distance > 0 ? distance : null,
    elevationGain: activity.elevationGain ?? null,
    avgHeartrate: activity.averageHR ? Math.round(activity.averageHR) : null,
    maxHeartrate: activity.maxHR ? Math.round(activity.maxHR) : null,
    avgSpeed: activity.averageSpeed ?? null,
    maxSpeed: activity.maxSpeed ?? null,
    avgCadence: activity.averageRunningCadenceInStepsPerMinute ?? null,
    avgWatts: typeof activity.avgPower === "number" ? Math.round(activity.avgPower) : null,
    sufferScore: null, // Garmin doesn't expose Strava's "suffer score".
  };
}

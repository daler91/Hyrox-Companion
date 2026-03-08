import {
  formatPace as formatPaceShared,
  formatElevation,
  type DistanceUnit,
} from "@shared/unitConversion";

interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  start_date: string;
  start_date_local: string;
  distance: number;
  moving_time: number;
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

function formatStravaDistance(meters: number, distanceUnit: DistanceUnit): string {
  const km = meters / 1000;
  if (distanceUnit === "miles") {
    const miles = km * 0.621371;
    return `${miles.toFixed(2)} mi`;
  }
  return `${km.toFixed(2)} km`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatStravaPace(metersPerSecond: number, distanceUnit: DistanceUnit): string {
  if (metersPerSecond <= 0) return "";
  return formatPaceShared(metersPerSecond, distanceUnit);
}

export function mapStravaActivityToWorkout(activity: StravaActivity, userId: string, distanceUnit: DistanceUnit = "km") {
  const durationMinutes = Math.round(activity.moving_time / 60);
  const isDistanceActivity = activity.distance > 100;

  const mainWorkout = isDistanceActivity
    ? `${formatStravaDistance(activity.distance, distanceUnit)}, ${formatDuration(activity.moving_time)}`
    : `${formatDuration(activity.moving_time)} session`;

  const accessoryParts: string[] = [];
  if (activity.total_elevation_gain > 0) {
    accessoryParts.push(`Elevation: ${formatElevation(activity.total_elevation_gain, distanceUnit)}`);
  }
  if (isDistanceActivity && activity.average_speed > 0) {
    accessoryParts.push(`Pace: ${formatStravaPace(activity.average_speed, distanceUnit)}`);
  }
  const accessory = accessoryParts.length > 0 ? accessoryParts.join(" | ") : null;

  const notesParts: string[] = [];
  if (activity.name) {
    notesParts.push(activity.name);
  }
  if (activity.average_heartrate) {
    const hrText = activity.max_heartrate
      ? `Avg HR: ${Math.round(activity.average_heartrate)} bpm (max ${Math.round(activity.max_heartrate)})`
      : `Avg HR: ${Math.round(activity.average_heartrate)} bpm`;
    notesParts.push(hrText);
  }
  const notes = notesParts.length > 0 ? notesParts.join(" | ") : null;

  return {
    userId,
    date: activity.start_date_local.split("T")[0],
    focus: activity.sport_type || activity.type || "Workout",
    mainWorkout,
    accessory,
    notes,
    duration: durationMinutes,
    rpe: null,
    planDayId: null,
    source: "strava" as const,
    stravaActivityId: String(activity.id),
    calories: activity.calories || activity.kilojoules ? Math.round((activity.calories || 0) || (activity.kilojoules || 0) * 0.239) : null,
    distanceMeters: activity.distance || null,
    elevationGain: activity.total_elevation_gain || null,
    avgHeartrate: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
    maxHeartrate: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
    avgSpeed: activity.average_speed || null,
    maxSpeed: activity.max_speed || null,
    avgCadence: activity.average_cadence || null,
    avgWatts: activity.average_watts ? Math.round(activity.average_watts) : null,
    sufferScore: activity.suffer_score || null,
  };
}

export type { StravaActivity };

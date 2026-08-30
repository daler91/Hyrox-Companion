import {
  type DistanceUnit,
  formatNumberWithUnit,
  formatPace as formatPaceShared,
  metersToUserDistance,
} from "@shared/unitConversion";

/**
 * Text formatting shared by the Strava and Garmin activity-to-workout mappers,
 * so imported sessions read identically regardless of source.
 */

export function formatActivityDistance(meters: number, distanceUnit: DistanceUnit): string {
  const converted = metersToUserDistance(meters, distanceUnit);
  const unitStr = distanceUnit === "miles" ? "mi" : "km";
  return formatNumberWithUnit(converted, unitStr, 2);
}

export function formatActivityDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function formatActivityPace(metersPerSecond: number, distanceUnit: DistanceUnit): string {
  if (metersPerSecond <= 0) return "";
  return formatPaceShared(metersPerSecond, distanceUnit);
}

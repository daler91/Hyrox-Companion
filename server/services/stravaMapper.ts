import { countsAsTraining } from "@shared/deviceSportTypes";
import type { StravaActivitySummary } from "@shared/schema";
import { type DistanceUnit, formatElevation } from "@shared/unitConversion";

import {
  formatActivityDistance,
  formatActivityDuration,
  formatActivityPace,
} from "./activityFormatting";

// The list-row shape lives in shared (StravaActivitySummary) because the
// device-link snapshot column stores it verbatim; this alias keeps the
// mapper's existing import surface.
type StravaActivity = StravaActivitySummary;

export function formatStravaPace(metersPerSecond: number, distanceUnit: DistanceUnit): string {
  return formatActivityPace(metersPerSecond, distanceUnit);
}

export function formatStravaDistance(meters: number, distanceUnit: DistanceUnit): string {
  return formatActivityDistance(meters, distanceUnit);
}

/** Thermodynamic conversion. Correct for FOOD energy, which is already metabolic. */
const KCAL_PER_KJ = 0.239;

/**
 * Gross mechanical efficiency of cycling — the share of metabolic energy that
 * leaves the body as work at the pedals. Trained cyclists sit around 20-25%.
 */
const CYCLING_GROSS_EFFICIENCY = 0.24;

/**
 * Kilocalories burned per kilojoule of WORK RECORDED BY A POWER METER.
 *
 * Strava's `kilojoules` is mechanical work (rides only), not energy expenditure.
 * Converting it with the thermodynamic factor alone gives that work restated in
 * kcal and ignores how inefficiently the body produced it, which understated a
 * ride's expenditure by about 4x (audit M16). Dividing by efficiency first is
 * what makes it an expenditure:
 *
 *   1 kJ of work / 0.24 = 4.17 kJ metabolic -> 4.17 x 0.239 = 0.996 kcal
 *
 * The two factors very nearly cancel, which is why "1 kJ of work is about
 * 1 kcal burned" is the standard cycling convention. Derived here rather than
 * written as 1 so the near-cancellation reads as arithmetic and not as a claim
 * that kJ and kcal are the same unit.
 */
const KCAL_PER_KJ_OF_WORK = KCAL_PER_KJ / CYCLING_GROSS_EFFICIENCY;

function getCalories(activity: StravaActivity): number | null {
  if (activity.calories) {
    return Math.round(activity.calories);
  }
  if (activity.kilojoules) {
    return Math.round(activity.kilojoules * KCAL_PER_KJ_OF_WORK);
  }
  return null;
}

function getAccessory(activity: StravaActivity, distanceUnit: DistanceUnit, isDistanceActivity: boolean): string | null {
  const accessoryParts: string[] = [];
  if (activity.total_elevation_gain > 0) {
    accessoryParts.push(`Elevation: ${formatElevation(activity.total_elevation_gain, distanceUnit)}`);
  }
  if (isDistanceActivity && activity.average_speed > 0) {
    accessoryParts.push(`Pace: ${formatStravaPace(activity.average_speed, distanceUnit)}`);
  }
  return accessoryParts.length > 0 ? accessoryParts.join(" | ") : null;
}

function getNotes(activity: StravaActivity): string | null {
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
  return notesParts.length > 0 ? notesParts.join(" | ") : null;
}

export function mapStravaActivityToWorkout(activity: StravaActivity, userId: string, distanceUnit: DistanceUnit = "km") {
  const durationMinutes = Math.round(activity.moving_time / 60);
  const isDistanceActivity = activity.distance > 100;

  const mainWorkout = isDistanceActivity
    ? `${formatStravaDistance(activity.distance, distanceUnit)}, ${formatActivityDuration(activity.moving_time)}`
    : `${formatActivityDuration(activity.moving_time)} session`;

  const accessory = getAccessory(activity, distanceUnit, isDistanceActivity);
  const notes = getNotes(activity);

  return {
    userId,
    // start_date_local is the athlete's local wall-clock time per the Strava
    // API contract, so this calendar date lines up with the nutrition module's
    // user-timezone logDate (block view / fuelling range / energy day-joins).
    date: activity.start_date_local.split("T")[0],
    // Preserve the true start instant (Phase 3 fuelling windows); start_date is UTC ISO.
    startedAt: activity.start_date ? new Date(activity.start_date) : null,
    focus: activity.sport_type || activity.type || "Workout",
    mainWorkout,
    accessory,
    notes,
    duration: durationMinutes,
    rpe: null,
    planDayId: null,
    source: "strava" as const,
    stravaActivityId: String(activity.id),
    // Stamped once, here, from the sport type; only the athlete changes it
    // afterwards (see the column note in tables.ts).
    countsAsTraining: countsAsTraining(activity.sport_type || activity.type),
    calories: getCalories(activity),
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

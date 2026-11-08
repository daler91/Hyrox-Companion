import { countsAsTraining } from "@shared/deviceSportTypes";
import type { HealthConnectSessionInput } from "@shared/schema";
import type { DistanceUnit } from "@shared/unitConversion";

import { formatActivityDistance, formatActivityDuration, formatActivityPace } from "./activityFormatting";
import type { ActivityMeasurements } from "./deviceActivitySets";

/** Sessions shorter than this cover no ground worth a distance line ("12 m, 3:00"). */
const MIN_DISTANCE_METERS = 100;

/**
 * The session's calendar date where it was recorded: the start instant
 * shifted by the record's own UTC offset, else by the athlete's time zone.
 * The nutrition day and the timeline both key on this local date.
 */
export function healthConnectLocalDate(session: HealthConnectSessionInput, timeZone: string | null | undefined): string {
  const start = new Date(session.startTime);
  if (session.zoneOffsetMinutes !== undefined) {
    return new Date(start.getTime() + session.zoneOffsetMinutes * 60_000).toISOString().slice(0, 10);
  }
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
  } catch {
    return start.toISOString().slice(0, 10);
  }
}

function sessionSeconds(session: HealthConnectSessionInput): number {
  return Math.round((Date.parse(session.endTime) - Date.parse(session.startTime)) / 1000);
}

function notesFor(session: HealthConnectSessionInput): string | null {
  const parts: string[] = [];
  if (session.title) parts.push(session.title);
  if (session.avgHeartRate) {
    parts.push(
      session.maxHeartRate
        ? `Avg HR: ${session.avgHeartRate} bpm (max ${session.maxHeartRate})`
        : `Avg HR: ${session.avgHeartRate} bpm`,
    );
  }
  return parts.length > 0 ? parts.join(" | ") : null;
}

/**
 * A Health Connect session as a standalone workout log, the same shape the
 * Strava and Garmin mappers give their imports. Health Connect records no
 * moving time, so the session's span stands in for it.
 */
export function mapHealthConnectSessionToWorkout(
  session: HealthConnectSessionInput,
  userId: string,
  options: { distanceUnit?: DistanceUnit; timeZone?: string | null } = {},
) {
  const distanceUnit = options.distanceUnit ?? "km";
  const seconds = sessionSeconds(session);
  const distance = session.distanceMeters ?? 0;
  const hasDistance = distance > MIN_DISTANCE_METERS;
  const avgSpeed = hasDistance && seconds > 0 ? distance / seconds : null;
  return {
    userId,
    date: healthConnectLocalDate(session, options.timeZone),
    startedAt: new Date(session.startTime),
    focus: session.sportType,
    mainWorkout: hasDistance
      ? `${formatActivityDistance(distance, distanceUnit)}, ${formatActivityDuration(seconds)}`
      : `${formatActivityDuration(seconds)} session`,
    accessory: avgSpeed ? `Pace: ${formatActivityPace(avgSpeed, distanceUnit)}` : null,
    notes: notesFor(session),
    duration: Math.round(seconds / 60),
    rpe: null as number | null,
    planDayId: null,
    source: "health_connect" as const,
    healthConnectId: session.id,
    countsAsTraining: countsAsTraining(session.sportType),
    calories: session.activeCalories ? Math.round(session.activeCalories) : null,
    distanceMeters: session.distanceMeters ?? null,
    avgHeartrate: session.avgHeartRate ?? null,
    maxHeartrate: session.maxHeartRate ?? null,
    avgSpeed,
  };
}

export type HealthConnectWorkoutRow = ReturnType<typeof mapHealthConnectSessionToWorkout>;

/** What the session's synthesised exercise set is built from (deviceActivitySets.ts). */
export function healthConnectRecordingMeasurements(session: HealthConnectSessionInput): ActivityMeasurements {
  return { sportType: session.sportType, movingSeconds: sessionSeconds(session), distanceMeters: session.distanceMeters ?? 0 };
}

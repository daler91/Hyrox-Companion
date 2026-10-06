import { formatSecondsToClock } from "@shared/formatClock";
import type { PersonalRecordMetric } from "@shared/schema";
import { getStoredDistanceUnit } from "@shared/unitConversion";
import { minutes, minutesToSeconds } from "@shared/units";

import { formatSecondsToMmSs } from "./statsUtils";

/** The athlete's units, as useUnitPreferences reports them. */
export interface PersonalRecordUnits {
  readonly weightLabel: string;
  readonly distanceUnit: "km" | "miles";
}

const SECONDS_PER_HOUR = 3600;

/**
 * A best time as a race clock. `bestTime` is `exercise_sets.time`, in MINUTES
 * and often fractional: 3.7666667 reads "3:46", a 45 s plank (0.75) "0:45",
 * and a time of an hour or more gains its hours ("1:02:03").
 */
export function formatRecordTime(storedMinutes: number): string {
  const totalSeconds = Math.round(minutesToSeconds(minutes(storedMinutes)));
  return totalSeconds >= SECONDS_PER_HOUR
    ? formatSecondsToClock(totalSeconds)
    : formatSecondsToMmSs(totalSeconds);
}

/** A weight or distance without float noise: at most two decimals, none when whole. */
export function formatRecordAmount(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * A PR value in the unit it is actually stored in, for every surface that
 * shows one: the weekly review, the PR list and the new-PR toast.
 *
 * Every branch used to assume a unit the column does not guarantee:
 *
 *   - `bestTime` came from `exercise_sets.time`, which is MINUTES, and went to
 *     `formatSecondsToMmSs` -- a 12-minute best rendered as "0:12" (audit H2).
 *   - `maxDistance` and the weight metrics are stored in the athlete's OWN
 *     display unit, not a canonical one (the S5 sentinel in unitConversion.ts),
 *     so a miles-preference athlete's feet were labelled "m" and a lbs-preference
 *     athlete's pounds were labelled "kg".
 *
 * The PR list and the toast missed that fix and printed raw decimal minutes
 * ("3.7666667min", "Best time 3.9") and unitless weights and distances.
 * CL35, CL58 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function formatPersonalRecordValue(
  metric: PersonalRecordMetric,
  value: number,
  units: PersonalRecordUnits,
): string {
  if (metric === "bestTime") return formatRecordTime(value);
  if (metric === "maxDistance") {
    return `${formatRecordAmount(value)} ${getStoredDistanceUnit(units.distanceUnit)}`;
  }
  return `${formatRecordAmount(value)} ${units.weightLabel}`;
}

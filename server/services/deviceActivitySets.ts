/**
 * The one exercise set a standalone device import carries.
 *
 * A device import used to land as a `workout_logs` row with no `exercise_sets`
 * at all, and roughly half of the Analytics tab reads sets rather than logs:
 * the training-distribution pie (`buildCategoryTotals`), movement-pattern
 * coverage, the muscle heat map, personal records and the progression charts
 * are all set-derived. So an athlete whose running all arrives from Strava saw
 * a pie with no Running slice and an empty PR list, while the overview cards —
 * which aggregate logs — counted every one of those runs. The two halves of the
 * same tab disagreed, and nothing was wrong with either calculation.
 *
 * A recording knows exactly one thing in set terms: this much distance in this
 * much time, of this kind of work. That is what this module writes, once, per
 * standalone import. It is deliberately NOT written for:
 *
 *   - an import that ATTACHED to a log the athlete wrote themselves. Their own
 *     text is the better description of that session, and it is what the AI
 *     parser reads; a synthesised row would both duplicate their sets and hide
 *     the log from `getWorkoutsWithoutExerciseSets`.
 *   - an import that COMPLETED a plan day, which already copies the day's
 *     prescribed sets across.
 *   - a sport we cannot describe as a set. "WeightTraining" and "Workout" say
 *     an hour happened and nothing about what was in it; inventing a set for
 *     those would put fiction into the PR table. Those logs keep the behaviour
 *     they have always had (duration and HR reach the overview and the training
 *     load; nothing reaches the set-derived panels).
 *
 * Training load is unaffected by design. A synthesised row is never a strength
 * set (`isStrengthSet` needs reps, which it has none of), so no tonnage appears
 * from nowhere; it IS a cardio set, which only moves the workout's existing
 * duration-based stress from `inferredWorkoutTag`'s text-inferred profile onto
 * the catalogue's real tag for the exercise — same magnitude, same 0.25 damping
 * (see `applyCardioLoad`), better attribution.
 */

import {
  EXERCISE_DEFINITIONS,
  type ExerciseName,
  type InsertExerciseSet,
  type StravaActivitySummary,
  users,
  type WorkoutLog,
} from "@shared/schema";
import { normalizeParsedDistance, stampForPreferences, type UnitPreferences } from "@shared/unitConversion";
import { seconds, secondsToMinutes, unitless } from "@shared/units";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";

/**
 * Strava `sport_type` → the catalogue exercise that describes it.
 *
 * Keyed lowercase because `sport_type` is PascalCase ("TrailRun") and the older
 * `type` field is not always spelled the same way. A sport that is absent here
 * gets no set, which is the honest answer for anything whose content the
 * recording does not describe — see the module note.
 *
 * The bike variants all collapse to `cycling`: the catalogue draws no line
 * between gravel and road, and neither does anything that reads these sets.
 */
const SPORT_TYPE_EXERCISE: Readonly<Record<string, ExerciseName>> = {
  run: "run",
  trailrun: "run",
  // Zwift and treadmill runs both arrive as VirtualRun, and `treadmill_run` is
  // the catalogue's name for "ran indoors".
  virtualrun: "treadmill_run",
  ride: "cycling",
  virtualride: "cycling",
  mountainbikeride: "cycling",
  gravelride: "cycling",
  ebikeride: "cycling",
  handcycle: "cycling",
  rowing: "rowing",
  virtualrow: "rowing",
  swim: "swimming",
  walk: "walking",
  hike: "hiking",
  elliptical: "elliptical",
  stairstepper: "stair_climber",
};

export function exerciseNameForSportType(sportType: string | null | undefined): ExerciseName | null {
  if (!sportType) return null;
  return SPORT_TYPE_EXERCISE[sportType.trim().toLowerCase()] ?? null;
}

/** The moving time and distance a log's recording measured. */
interface ActivityMeasurements {
  sportType: string;
  movingSeconds: number;
  distanceMeters: number;
}

/**
 * What the log's own recording says, preferring the raw snapshot over the
 * derived columns.
 *
 * `workout_logs.duration` is whole MINUTES, so reading the clock off it loses
 * up to 30 seconds — enough to move a 10 km pace by 3 s/km and enough to make a
 * "best time" PR wrong. The snapshot keeps `moving_time` in seconds, so use it
 * whenever it is there; the column fallback exists for rows imported before the
 * snapshot column did.
 */
function measurementsFor(log: WorkoutLog): ActivityMeasurements | null {
  const raw: StravaActivitySummary | undefined = log.deviceActivity?.raw;
  const sportType = raw?.sport_type || raw?.type || log.focus;
  if (!sportType) return null;
  return {
    sportType,
    movingSeconds: raw?.moving_time ?? (log.duration ?? 0) * 60,
    distanceMeters: raw?.distance ?? log.distanceMeters ?? 0,
  };
}

/**
 * The set row for one standalone device log, or null when the recording does
 * not describe one (unmapped sport, or a stopped clock).
 *
 * `preferences` are the athlete's units: the row is stamped with them like every
 * other set the product writes (L4), so a later kg/lbs or km/miles switch
 * converts this row instead of reinterpreting it.
 */
export function deviceActivitySetRow(
  log: WorkoutLog,
  preferences: UnitPreferences,
): InsertExerciseSet | null {
  const measurements = measurementsFor(log);
  if (!measurements) return null;

  const exerciseName = exerciseNameForSportType(measurements.sportType);
  if (!exerciseName) return null;
  // A recording with no elapsed movement describes no effort. Guard rather than
  // write a zero-minute set, which would land in the PR table as an unbeatable
  // "best time". The finite check is not redundant with `<= 0`: a malformed
  // snapshot can carry a NaN, and NaN fails every comparison, so `<= 0` alone
  // would wave it through into the `time` column.
  if (!Number.isFinite(measurements.movingSeconds) || measurements.movingSeconds <= 0) return null;

  const stamp = stampForPreferences(preferences);
  return {
    workoutLogId: log.id,
    planDayId: null,
    exerciseName,
    customLabel: null,
    category: EXERCISE_DEFINITIONS[exerciseName].category,
    setNumber: 1,
    reps: null,
    weight: null,
    // Stored in the athlete's stored distance unit (m, or ft for a miles
    // athlete) — Strava reports metres regardless.
    distance:
      measurements.distanceMeters > 0
        ? normalizeParsedDistance(measurements.distanceMeters, "m", preferences)
        : null,
    // exercise_sets.time is MINUTES, fractional (docs/adr-units.md).
    time: unitless(secondsToMinutes(seconds(measurements.movingSeconds))),
    weightUnit: stamp.weightUnit,
    distanceUnit: stamp.distanceUnit,
    sortOrder: 0,
  };
}

/** The set rows for a batch of freshly-created standalone device logs. */
export function deviceActivitySetRows(
  logs: readonly WorkoutLog[],
  preferences: UnitPreferences,
): InsertExerciseSet[] {
  const rows: InsertExerciseSet[] = [];
  for (const log of logs) {
    const row = deviceActivitySetRow(log, preferences);
    if (row) rows.push(row);
  }
  return rows;
}

/** One athlete the backfill has to visit, with the units their rows get stamped in. */
export interface BackfillAthlete {
  id: string;
  preferences: UnitPreferences;
}

/**
 * Every athlete the backfill should walk, with their own units.
 *
 * Lives here rather than in the script for the same reason `legacyUnitBackfill`
 * owns its queries: the operator entry point should choose flags and print, not
 * reach into tables. Reading each athlete's units HERE is also what keeps the
 * per-athlete stamp honest — one operator-supplied unit applied to the whole
 * table is the exact corruption the L4 stamp exists to prevent.
 */
export async function listBackfillAthletes(userId?: string): Promise<BackfillAthlete[]> {
  const query = db
    .select({ id: users.id, weightUnit: users.weightUnit, distanceUnit: users.distanceUnit })
    .from(users);
  const rows = userId ? await query.where(eq(users.id, userId)) : await query;
  return rows.map((row) => ({
    id: row.id,
    preferences: { weightUnit: row.weightUnit, distanceUnit: row.distanceUnit },
  }));
}

/**
 * Give every standalone device import that predates this module its set.
 *
 * The sync only writes a set for activities it imports from now on, which would
 * leave an athlete's existing history — the part they actually look at — still
 * invisible to the set-derived panels. This closes that gap for one athlete.
 *
 * Idempotent: the query is an anti-join against `exercise_sets`, so a second run
 * finds nothing. Returns the counts so a caller can report them.
 *
 * `apply: false` resolves exactly the rows a write would and reports them
 * without touching the database, so an operator's dry run and their subsequent
 * `--apply` cannot disagree about what is about to happen.
 */
export async function backfillDeviceActivitySets(
  athlete: BackfillAthlete,
  apply: boolean,
): Promise<{ candidates: number; written: number }> {
  const logs = await storage.workouts.getStandaloneDeviceLogsWithoutSets(athlete.id);
  const rows = deviceActivitySetRows(logs, athlete.preferences);
  const written = apply ? await storage.workouts.createDeviceActivitySets(rows) : rows.length;
  return { candidates: logs.length, written };
}

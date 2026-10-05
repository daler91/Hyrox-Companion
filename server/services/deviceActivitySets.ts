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
 * standalone import, and once per plan-day log an AUTO link creates (D12,
 * CODEBASE_ANALYSIS_2026-10-03): nobody has reviewed that link, so the log
 * records what the watch measured, never the prescription as performed. When
 * the recording leaves such a log (unlink, "Reopen workout"), its set leaves
 * with it while the athlete has not corrected it, a note on it going along
 * (`isUncorrectedRecordingSet` in deviceActivityLink.ts: the stored set still
 * holds both of the watch's numbers and none of `AthleteSetDetails`). It is
 * deliberately NOT written for:
 *
 *   - an import that ATTACHED to a log the athlete wrote themselves. Their own
 *     text is the better description of that session, and it is what the AI
 *     parser reads; a synthesised row would both duplicate their sets and hide
 *     the log from `getWorkoutsWithoutExerciseSets`.
 *   - an import the athlete MANUALLY linked to a plan day. They said the
 *     recording was that session, so the link copies the day's prescribed
 *     sets across, as "Log as planned" does.
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
  // Garmin's `activityType.typeKey` spellings of the same sports. A Garmin
  // import's set is built from the activity itself (`recordingSetRow`), and
  // without these keys a Garmin-only athlete still had no running slice and
  // no running PRs. None of them is a Strava `sport_type` lowercased, so no
  // stored Strava set changes. C26 (CODEBASE_ANALYSIS_2026-10-03)
  running: "run",
  trail_running: "run",
  track_running: "run",
  street_running: "run",
  treadmill_running: "treadmill_run",
  indoor_running: "treadmill_run",
  virtual_run: "treadmill_run",
  cycling: "cycling",
  road_biking: "cycling",
  mountain_biking: "cycling",
  gravel_cycling: "cycling",
  indoor_cycling: "cycling",
  virtual_ride: "cycling",
  cyclocross: "cycling",
  e_bike_fitness: "cycling",
  e_bike_mountain: "cycling",
  hand_cycling: "cycling",
  lap_swimming: "swimming",
  open_water_swimming: "swimming",
  walking: "walking",
  casual_walking: "walking",
  speed_walking: "walking",
  hiking: "hiking",
  indoor_rowing: "rowing",
  stair_climbing: "stair_climber",
};

export function exerciseNameForSportType(sportType: string | null | undefined): ExerciseName | null {
  if (!sportType) return null;
  return SPORT_TYPE_EXERCISE[sportType.trim().toLowerCase()] ?? null;
}

/** The moving time and distance a log's recording measured. */
export interface ActivityMeasurements {
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
 *
 * STORED ROWS DEPEND ON THIS OUTPUT. `isUncorrectedRecordingSet` and
 * `isCorrectedRecordingSet` (deviceActivityLink.ts) know the set an auto link
 * wrote on a plan-day log by calling this again on the stored recording and
 * comparing the result with the stored set: exercise, distance, moving time.
 * The set that leaves with the recording (`isUncorrectedRecordingSet`) must
 * match in all three and carry none of `AthleteSetDetails`, a note at most.
 * Change what this returns for a recording (the sport map, the rounding, the
 * unit stamp, the clock source) and every set already written stops
 * matching, so unlink and "Reopen workout" read each one as a set the athlete
 * typed: unlink keeps it on the log while the released recording gets its
 * own (the run counted twice), and reopen adds the watch's numbers to the
 * plan day's prescription as a run the athlete added. `deviceActivitySets.test.ts`
 * pins the output with literal values; a change that moves them needs a way
 * to recognise the rows already written. D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function deviceActivitySetRow(
  log: WorkoutLog,
  preferences: UnitPreferences,
): InsertExerciseSet | null {
  const measurements = measurementsFor(log);
  if (!measurements) return null;
  return recordingSetRow(log.id, measurements, preferences);
}

/**
 * The set row for a recording's measurements on the log `workoutLogId`, or
 * null when they describe no set. `deviceActivitySetRow` reads them off a
 * Strava log; the Garmin sync passes the activity's own (C26), which carry
 * the clock in seconds where the row's `duration` holds whole minutes.
 */
export function recordingSetRow(
  workoutLogId: string,
  measurements: ActivityMeasurements,
  preferences: UnitPreferences,
): InsertExerciseSet | null {
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
    workoutLogId,
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

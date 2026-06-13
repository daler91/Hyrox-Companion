/**
 * Estimate a planned session's duration and intensity from the workout's already
 * saved exercise table — structure blocks (EMOM/AMRAP/for-time/intervals/…) and
 * planned exercise sets. Feeds `computeSessionFuellingTarget` so a planned
 * workout can show a pre-session fuelling target before it's ever logged.
 *
 * Browser-safe and DB-free (mirrors `shared/sessionFuellingTargets.ts`): typed
 * Input/Result, no I/O. The numbers are rough coaching heuristics — the athlete
 * can always override duration/intensity explicitly on the plan day.
 *
 * Distance-aware: a distance-only cardio set (e.g. a 9000 m recovery run with no
 * prescribed time) is converted to minutes via a per-exercise default pace, and
 * given a default RPE, so the fuelling target reflects the real session length and
 * intensity instead of falling back to the 10-minute floor and an assumed-moderate
 * effort. Running paces can be scaled by a personalized `runPaceRatio` (clamped so
 * it never strays far from the generic defaults).
 */

import { EXERCISE_DEFINITIONS, type ExerciseName, normalizeExerciseName } from "./schema/exercises";
import { storedDistanceToMeters } from "./unitConversion";

/** Block-level timing/intensity fields (a structural subset of StructureBlockInput). */
export interface PlannedSessionBlock {
  formatType?: string | null;
  sectionType?: string | null;
  durationMinutes?: number | null;
  durationSeconds?: number | null;
  timeCapMinutes?: number | null;
  roundCount?: number | null;
  rounds?: number | null;
  workSeconds?: number | null;
  restSeconds?: number | null;
  workIntervalSec?: number | null;
  restIntervalSec?: number | null;
}

/** Set-level fields used when no block carries timing (subset of ExerciseSet). */
export interface PlannedSessionSet {
  /** Prescribed time in MINUTES; falls back to logged `time` (minutes) when present. */
  plannedTime?: number | null;
  time?: number | null;
  plannedReps?: number | null;
  reps?: number | null;
  /** Prescribed distance in the user's stored unit (m for km users, ft for miles users). */
  plannedDistance?: number | null;
  distance?: number | null;
  /** Canonical exercise key (e.g. "recovery_run") or human label; normalized internally. */
  exerciseName?: string | null;
}

export interface PlannedSessionEstimateInput {
  structureBlocks?: readonly PlannedSessionBlock[] | null;
  exerciseSets?: readonly PlannedSessionSet[] | null;
  /** User distance preference so stored distance → meters. Defaults to "km" (meters). */
  distanceUnit?: string | null;
  /**
   * Personalized running-pace multiplier vs the generic defaults: <1 = faster than
   * generic, >1 = slower. Clamped to [MIN_RUN_PACE_RATIO, MAX_RUN_PACE_RATIO] so a
   * personalized estimate is grounded to the defaults and never extreme. Defaults to 1.
   */
  runPaceRatio?: number | null;
}

export interface PlannedSessionEstimate {
  /** Estimated session duration in minutes, or null when nothing usable. */
  durationMin: number | null;
  /** Estimated intensity (RPE 1–10) inferred from block formats or set exercises, or null. */
  rpe: number | null;
  /** Where the duration estimate came from, for UI transparency. */
  source: "structure" | "sets" | "none";
}

const MIN_DURATION_MIN = 10;
const MAX_DURATION_MIN = 180;
// Rough wall-clock per set (incl. rest) when only a rep count / unknown movement is known.
const MINUTES_PER_SET = 3;

/** Bounds for the personalized running-pace multiplier — keeps it near the generic defaults. */
export const MIN_RUN_PACE_RATIO = 0.8;
export const MAX_RUN_PACE_RATIO = 1.25;

/**
 * Generic "typical run" pace (sec/m, ~5:45/km) — the conservative middle of the run
 * band. Doubles as the anchor the server divides a logged median run pace by to derive
 * a personalized `runPaceRatio`, so personalization scales the whole band off one number.
 */
export const GENERIC_RUN_PACE_SEC_PER_M = 0.345;

/**
 * Default pace in SECONDS PER METER for distance-based cardio, keyed by canonical
 * exercise. `pace(min/km) = secPerM * 1000 / 60`. Mid-pack recreational defaults
 * (a Hyrox-companion audience) chosen so a 9000 m recovery run lands ~54 min.
 * Exported so the server can derive a personalized `runPaceRatio` from the easy-run baseline.
 */
export const PACE_SEC_PER_M: Partial<Record<ExerciseName, number>> = {
  // Running (min/km in comments)
  recovery_run: 0.36, //  6:00/km  → 9000 m ≈ 54 min
  easy_run: 0.33, //  5:30/km
  long_run: 0.345, //  5:45/km
  tempo_run: 0.27, //  4:30/km
  fartlek_run: 0.3, //  5:00/km
  run_1k: 0.3, //  5:00/km
  treadmill_run: 0.33, //  5:30/km
  interval_run: 0.255, //  4:15/km work pace (rest uplift applied separately)
  hill_repeats: 0.3, //  5:00/km effective
  sprints: 0.2, //  3:20/km work pace
  // Ergs / bikes — "distance" is covered far faster than running.
  rowing: 0.25, // ~2:05 /500 m → 2000 m ≈ 8.3 min
  skierg: 0.255,
  bike_erg: 0.09, // ~6.7 m/s erg distance
  cycling: 0.09,
  assault_bike: 0.11,
  echo_bike: 0.11,
  stationary_bike: 0.1,
  // Walking / hiking / rucking.
  walking: 0.72, // ~5 km/h
  incline_walk: 0.8,
  hiking: 0.9, // ~4 km/h w/ terrain
  rucking: 0.84,
  elliptical: 0.3,
  stair_climber: 0.5,
  // Swimming — short distances, slow per meter.
  swimming: 1.2, // ~2:00 /100 m
};

/**
 * Category-level pace fallback (sec/m) for distance exercises not explicitly listed.
 * "functional" is intentionally excluded so short carries/sleds (50–200 m) fall through
 * to the per-set floor rather than getting a meaningless sub-minute distance time;
 * functional ergs (rowing/skierg) are paced via their explicit entries above.
 */
const PACE_SEC_PER_M_BY_CATEGORY: Partial<Record<string, number>> = {
  running: GENERIC_RUN_PACE_SEC_PER_M, // ~5:45/km, conservative middle of the run band
  conditioning: 0.3,
};

/** Unknown exercise name (normalizeExerciseName → null) but a distance is present. */
const FALLBACK_PACE_SEC_PER_M = 0.345;

/** Interval-style running carries large between-rep recovery; uplift distance-derived work time. */
const INTERVAL_REST_MULTIPLIER = 1.8;
const INTERVAL_LIKE: ReadonlySet<ExerciseName> = new Set<ExerciseName>([
  "interval_run",
  "hill_repeats",
  "sprints",
  "fartlek_run",
]);

/**
 * Default session RPE by canonical exercise, used when no structure block implies
 * intensity. Exported for reuse/tests. Mirrors the format-based RPE proxy below.
 */
export const EXERCISE_RPE: Partial<Record<ExerciseName, number>> = {
  recovery_run: 2,
  easy_run: 3,
  long_run: 4,
  tempo_run: 6,
  fartlek_run: 7,
  run_1k: 6,
  treadmill_run: 3,
  interval_run: 8,
  hill_repeats: 8,
  sprints: 8,
  walking: 2,
  incline_walk: 3,
  hiking: 3,
  rucking: 4,
  rowing: 5,
  skierg: 5,
  bike_erg: 5,
  cycling: 4,
  stationary_bike: 4,
  elliptical: 4,
  assault_bike: 6,
  echo_bike: 6,
  swimming: 5,
};

const CATEGORY_RPE: Record<string, number> = {
  running: 4,
  conditioning: 5,
  functional: 6,
  strength: 6,
};

const FALLBACK_RPE = 5;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** First strictly-positive, finite value among the candidates, or null. */
function firstPositive(...values: Array<number | null | undefined>): number | null {
  for (const v of values) {
    if (v != null && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

/** Clamp a personalized pace multiplier into the grounded band; missing/invalid → 1 (generic). */
function normalizeRunPaceRatio(ratio: number | null | undefined): number {
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) return 1;
  return clamp(ratio, MIN_RUN_PACE_RATIO, MAX_RUN_PACE_RATIO);
}

/** Estimate one block's minutes, preferring the most explicit timing signal. */
function blockMinutes(b: PlannedSessionBlock): number {
  if (b.durationMinutes && b.durationMinutes > 0) return b.durationMinutes;
  if (b.durationSeconds && b.durationSeconds > 0) return b.durationSeconds / 60;
  if (b.timeCapMinutes && b.timeCapMinutes > 0) return b.timeCapMinutes;
  // Interval/EMOM-style: rounds × (work + rest).
  const rounds = b.roundCount ?? b.rounds ?? 0;
  const work = b.workSeconds ?? b.workIntervalSec ?? 0;
  const rest = b.restSeconds ?? b.restIntervalSec ?? 0;
  if (rounds > 0 && work + rest > 0) return (rounds * (work + rest)) / 60;
  return 0;
}

/** RPE proxy from a block's format — how glycogen-depleting it tends to be. */
function formatRpe(formatType: string | null | undefined): number | null {
  switch (formatType) {
    case "for_time":
    case "amrap":
      return 8;
    case "emom":
    case "interval":
    case "rounds":
      return 7;
    case "steady":
    case "quality":
      return 5;
    default:
      return null;
  }
}

/**
 * Distance pace (sec/m) for an exercise, or null when it shouldn't be distance-paced
 * (strength/carries → per-set floor). Running paces are scaled by `runPaceRatio`.
 */
function resolvePace(key: ExerciseName | null, runPaceRatio: number): number | null {
  if (key == null) return FALLBACK_PACE_SEC_PER_M; // unknown name but a distance was given
  const category = EXERCISE_DEFINITIONS[key].category;
  const explicit = PACE_SEC_PER_M[key];
  const pace = explicit ?? PACE_SEC_PER_M_BY_CATEGORY[category];
  if (pace == null) return null; // strength etc. → floor
  return category === "running" ? pace * runPaceRatio : pace;
}

/** Default RPE for a set's exercise, or null when there's nothing to key off (no name). */
function resolveRpe(exerciseName: string | null | undefined): number | null {
  if (!exerciseName) return null;
  const key = normalizeExerciseName(exerciseName);
  if (key == null) return FALLBACK_RPE; // a named-but-unrecognized movement still implies effort
  return EXERCISE_RPE[key] ?? CATEGORY_RPE[EXERCISE_DEFINITIONS[key].category] ?? FALLBACK_RPE;
}

/** Estimate one set's wall-clock minutes: explicit time → distance-derived → per-set floor. */
function setMinutes(
  set: PlannedSessionSet,
  distanceUnit: string | null | undefined,
  runPaceRatio: number,
): number {
  // 1. Explicit prescribed/actual time wins. Stored in MINUTES (app-wide convention).
  const explicitMin = firstPositive(set.plannedTime, set.time);
  if (explicitMin != null) return explicitMin;

  // 2. Distance-derived time, when the exercise is distance-paceable.
  const rawDistance = firstPositive(set.plannedDistance, set.distance);
  if (rawDistance != null) {
    const key = set.exerciseName ? normalizeExerciseName(set.exerciseName) : null;
    const secPerM = resolvePace(key, runPaceRatio);
    if (secPerM != null) {
      const meters = storedDistanceToMeters(rawDistance, distanceUnit);
      const minutes = (meters * secPerM) / 60;
      return key != null && INTERVAL_LIKE.has(key) ? minutes * INTERVAL_REST_MULTIPLIER : minutes;
    }
  }

  // 3. Floor: reps-only strength, carries/sleds, or movements we can't time from data.
  return MINUTES_PER_SET;
}

/** Session RPE from the most intense planned set, or null when nothing is recognizable. */
function setsRpe(sets: readonly PlannedSessionSet[]): number | null {
  const rpes = sets
    .map((s) => resolveRpe(s.exerciseName))
    .filter((r): r is number => r != null);
  return rpes.length > 0 ? Math.max(...rpes) : null;
}

export function estimatePlannedSession(input: PlannedSessionEstimateInput): PlannedSessionEstimate {
  const blocks = input.structureBlocks ?? [];
  const sets = input.exerciseSets ?? [];
  const distanceUnit = input.distanceUnit ?? "km";
  const runPaceRatio = normalizeRunPaceRatio(input.runPaceRatio);

  // --- Duration: prefer structured block timing, else estimate from sets. ---
  const blockTotal = blocks.reduce((acc, b) => acc + blockMinutes(b), 0);
  let durationMin: number | null = null;
  let source: PlannedSessionEstimate["source"] = "none";
  if (blockTotal > 0) {
    durationMin = clamp(Math.round(blockTotal), MIN_DURATION_MIN, MAX_DURATION_MIN);
    source = "structure";
  } else if (sets.length > 0) {
    const setTimeMin = sets.reduce((acc, s) => acc + setMinutes(s, distanceUnit, runPaceRatio), 0);
    durationMin = clamp(Math.round(setTimeMin), MIN_DURATION_MIN, MAX_DURATION_MIN);
    source = "sets";
  }

  // --- Intensity: hardest "main" block format, else hardest of any block, else from sets. ---
  const rpeOf = (filter: (b: PlannedSessionBlock) => boolean): number[] =>
    blocks
      .filter(filter)
      .map((b) => formatRpe(b.formatType))
      .filter((r): r is number => r != null);
  const mainRpes = rpeOf((b) => b.sectionType === "main");
  const pool = mainRpes.length > 0 ? mainRpes : rpeOf(() => true);
  const blockRpe = pool.length > 0 ? Math.max(...pool) : null;
  const rpe = blockRpe ?? setsRpe(sets);

  return { durationMin, rpe, source };
}

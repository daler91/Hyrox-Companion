/**
 * Deterministic feature builder for the Race Predictor.
 *
 * Turns the athlete's logged exercise history into structured per-segment
 * features (best/median split, sample size, recency, logged load vs the
 * division-standard load) plus a deterministic baseline finish estimate. The
 * features are the input to the AI estimation layer, and the baseline is the
 * fallback whenever AI is unavailable — so this module is pure (no AI, no DB)
 * and fully unit-tested.
 *
 * Unit handling (see the 🛡️ sentinel in shared/unitConversion.ts):
 *  - `time` is stored in MINUTES → multiply by 60 for seconds.
 *  - A logged set may be a *partial* effort (e.g. a 500 m SkiErg interval, not
 *    the full 1000 m race station), so each set's time is projected to the full
 *    race-station amount with Riegel's endurance power law (T2 = T1·(D2/D1)^1.06)
 *    over the logged distance/reps vs the station target. We only trust efforts
 *    within 0.5×–2× of the full amount; further-out efforts are too unreliable to
 *    extrapolate and are dropped (the station then falls back to its benchmark).
 *    A set with no logged distance/reps is assumed to be a full effort.
 *  - logged distances are in the athlete's stored unit (m for km users, ft for
 *    miles users); we convert to meters with `storedDistanceToMeters` (read-only,
 *    so the read-convert-write drift caveat does not apply) before comparing.
 *    KNOWN LIMITATION (accepted): the sentinel also notes historical rows are not
 *    migrated when a user changes unit preference, so a station logged before a
 *    switch is read under the *current* unit. A mis-read effort simply falls
 *    outside the trust band and degrades to the station benchmark — a graceful,
 *    sane fallback, and the same mixed-unit trade-off the rest of the app accepts.
 *  - logged weights are in the athlete's unit; we never convert them. Instead
 *    we convert the canonical-kg standard INTO the athlete's unit
 *    (`kgToUserWeight`, the sanctioned direction) and compare there.
 */
import {
  type Division,
  type Gender,
  HYROX_STATION_ORDER,
  type HyroxStation,
  RACE_SEGMENTS,
  type RaceSegmentKind,
  resolveRaceReference,
  RUN_EXERCISE_NAME,
  RUN_LEG_DISTANCE_METERS,
  type StoredGender,
  TOTAL_STATIONS,
} from "@shared/raceSpec";
import { type ExerciseName, normalizeExerciseName } from "@shared/schema";
import { kgToUserWeight, storedDistanceToMeters } from "@shared/unitConversion";

import type { LoggedExerciseSetWithDate } from "../../storage/shared";

export interface SegmentFeature {
  exerciseName: ExerciseName;
  kind: RaceSegmentKind;
  /** Fastest logged completion in seconds, or null when never logged. */
  bestSeconds: number | null;
  /** Median logged completion in seconds, or null when never logged. */
  medianSeconds: number | null;
  /** Count of logged sets with a usable time. */
  sampleSize: number;
  /** Whole days since the most recent logged set, or null when never logged. */
  lastTrainedDaysAgo: number | null;
  /** Heaviest logged load in the athlete's weight unit, or null. */
  loggedLoadUserUnit: number | null;
  /** Division-standard load converted to the athlete's weight unit, or null. */
  standardLoadUserUnit: number | null;
  /** loggedLoad / standardLoad (same unit), or null when either is unknown. */
  loadRatio: number | null;
}

export interface BaselineSegmentEstimate {
  index: number;
  kind: RaceSegmentKind;
  exerciseName: ExerciseName;
  label: string;
  estimatedSeconds: number;
  basis: "logged" | "benchmark";
  sampleSize: number;
  /** Cohort reference split (station p50 / run-leg curve value), independent of
   *  the athlete's logged data — used as the anchor for the AI clamp. */
  benchmarkSeconds: number;
  /** Fastest physically-plausible split for this segment (≈ world-class). */
  floorSeconds: number;
}

export interface RacePredictionFeatures {
  division: Division;
  resolvedGender: Gender | null;
  genderAssumed: boolean;
  /** Canonical age band actually used, or null when an all-ages cohort was used. */
  resolvedAgeGroup: string | null;
  /** True when the athlete's specific age group was not applied (unknown or too thin). */
  ageGroupAssumed: boolean;
  weightUnit: string;
  runFeature: SegmentFeature;
  stationFeatures: Record<HyroxStation, SegmentFeature>;
  baselineSegments: BaselineSegmentEstimate[];
  /** Modeled total transition (roxzone) time included in the finish, in seconds. */
  transitionSeconds: number;
  deterministicFinishSeconds: number;
  dataCompleteness: { stationsWithData: number; totalStations: number; hasRunData: boolean };
}

export interface AthleteProfileInput {
  division: string | null | undefined;
  gender: StoredGender;
  weightUnit: string | null | undefined;
  distanceUnit?: string | null;
  /** Raw or canonical age-group label; resolved/normalized downstream. */
  ageGroup?: string | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function daysSince(dateStr: string, now: Date): number | null {
  const then = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((today - then) / 86_400_000));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// --- Race-realism model -----------------------------------------------------
// Logged efforts are FRESH gym efforts, but race splits are run under
// cumulative fatigue. So we (a) discount fresh efforts toward race pace, and
// (b) anchor every split on the real cohort median, letting the athlete's
// logged data move it only within a bounded band. This keeps the breakdown
// realistic and internally consistent — a fast gym time can't surface as a
// world-class race split next to field-median benchmark segments.
const RUN_FATIGUE_FACTOR = 1.15; // a fresh 1 km maps to a ~15% slower race run
const STATION_FATIGUE_FACTOR = 1.1; // a fresh station effort maps to ~10% slower
/** A personalized split stays within [MIN, MAX] × the cohort median: at most
 *  20% faster than the field median, up to 50% slower. */
export const MIN_PERSONAL_FRACTION = 0.8;
export const MAX_PERSONAL_FRACTION = 1.5;

/**
 * Adjust a logged station split for the gap between the load the athlete
 * trained at and the division-standard load. Conservative and clamped: trained
 * lighter than standard → predicted a little slower; trained heavier → a little
 * faster. Returns the input unchanged when the ratio is unknown.
 */
function loadAdjust(seconds: number, loadRatio: number | null): number {
  if (loadRatio == null || !Number.isFinite(loadRatio) || loadRatio <= 0) return seconds;
  const K = 0.25;
  const factor = clamp(1 + K * (1 - loadRatio), 0.85, 1.25);
  return seconds * factor;
}

/** The full race-station amount a logged set is normalized up/down to. */
interface SegmentTarget {
  distanceMeters?: number;
  reps?: number;
}

/** The athlete's stored units, used to interpret logged weights and distances. */
interface AthleteUnits {
  weightUnit: string;
  distanceUnit: string;
}

// Riegel's endurance power law (T2 = T1·(D2/D1)^EXP) projects a partial effort
// to the full race amount slightly worse than linear, matching how pace fades
// over distance/reps. 1.06 is Riegel's widely-used exponent.
const RIEGEL_EXPONENT = 1.06;
// Only trust an effort for projection when it covers between this fraction and
// this multiple of the full race amount; further out, extrapolation is too
// unreliable, so the set is dropped and the station falls back to its benchmark.
const MIN_TRUST_RATIO = 0.5;
const MAX_TRUST_RATIO = 2;

/** Power-law factor (target → logged), or null when logged is outside the trust band. */
function trustedFactor(target: number, logged: number): number | null {
  const ratio = logged / target;
  if (ratio < MIN_TRUST_RATIO || ratio > MAX_TRUST_RATIO) return null;
  return Math.pow(target / logged, RIEGEL_EXPONENT);
}

/** A logged measure (distance or reps) usable for projection, or null otherwise. */
function usableMeasure(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Factor that scales a logged partial effort's time to the full race-station
 * amount, or null when the effort is too far from the full amount to extrapolate
 * (the caller drops the set). Distance-based stations use the logged distance
 * (converted from the athlete's stored unit to meters); rep-based stations use
 * logged reps. A set with no usable distance/rep count is assumed full (1).
 */
function projectionFactor(
  set: LoggedExerciseSetWithDate,
  target: SegmentTarget,
  distanceUnit: string,
): number | null {
  if (target.distanceMeters != null) {
    const distance = usableMeasure(set.distance);
    if (distance == null) return 1;
    return trustedFactor(target.distanceMeters, storedDistanceToMeters(distance, distanceUnit));
  }
  if (target.reps != null) {
    const reps = usableMeasure(set.reps);
    if (reps == null) return 1;
    return trustedFactor(target.reps, reps);
  }
  return 1;
}

interface SegmentSetMetrics {
  timesSeconds: number[];
  loads: number[];
  mostRecent: string | null;
}

function accumulateSetMetrics(
  sets: LoggedExerciseSetWithDate[],
  target: SegmentTarget,
  distanceUnit: string,
): SegmentSetMetrics {
  const timesSeconds: number[] = [];
  const loads: number[] = [];
  let mostRecent: string | null = null;

  for (const set of sets) {
    if (set.time != null && Number.isFinite(set.time)) {
      const factor = projectionFactor(set, target, distanceUnit);
      // null → effort too far from the full station to trust; drop this split.
      if (factor != null) timesSeconds.push(set.time * 60 * factor);
    }
    if (set.weight != null && Number.isFinite(set.weight)) {
      loads.push(set.weight);
    }
    if (set.date && (mostRecent === null || set.date > mostRecent)) {
      mostRecent = set.date;
    }
  }

  return { timesSeconds, loads, mostRecent };
}

function buildSegmentFeature(
  exerciseName: ExerciseName,
  kind: RaceSegmentKind,
  sets: LoggedExerciseSetWithDate[],
  standardLoadKg: number | undefined,
  target: SegmentTarget,
  units: AthleteUnits,
  now: Date,
): SegmentFeature {
  const { timesSeconds, loads, mostRecent } = accumulateSetMetrics(
    sets,
    target,
    units.distanceUnit,
  );

  const loggedLoadUserUnit = loads.length > 0 ? Math.max(...loads) : null;
  const standardLoadUserUnit =
    standardLoadKg == null ? null : kgToUserWeight(standardLoadKg, units.weightUnit);
  const loadRatio =
    loggedLoadUserUnit != null && standardLoadUserUnit != null && standardLoadUserUnit > 0
      ? loggedLoadUserUnit / standardLoadUserUnit
      : null;

  return {
    exerciseName,
    kind,
    bestSeconds: timesSeconds.length > 0 ? Math.min(...timesSeconds) : null,
    medianSeconds: median(timesSeconds),
    sampleSize: timesSeconds.length,
    lastTrainedDaysAgo: mostRecent ? daysSince(mostRecent, now) : null,
    loggedLoadUserUnit,
    standardLoadUserUnit,
    loadRatio,
  };
}

/**
 * Build per-segment features and a deterministic baseline finish estimate from
 * the athlete's logged sets + competition profile.
 */
export function buildRacePredictionFeatures(
  sets: LoggedExerciseSetWithDate[],
  profile: AthleteProfileInput,
  now: Date = new Date(),
): RacePredictionFeatures {
  const weightUnit = profile.weightUnit || "kg";
  const distanceUnit = profile.distanceUnit || "km";
  const units: AthleteUnits = { weightUnit, distanceUnit };
  const { division, resolvedGender, genderAssumed, resolvedAgeGroup, ageGroupAssumed, reference } =
    resolveRaceReference(profile.division, profile.gender, profile.ageGroup);

  // Bucket logged sets by canonical exercise key.
  const byExercise = new Map<ExerciseName, LoggedExerciseSetWithDate[]>();
  for (const set of sets) {
    const canonical = normalizeExerciseName(set.exerciseName);
    if (!canonical) continue;
    const bucket = byExercise.get(canonical);
    if (bucket) bucket.push(set);
    else byExercise.set(canonical, [set]);
  }

  const runFeature = buildSegmentFeature(
    RUN_EXERCISE_NAME,
    "run",
    byExercise.get(RUN_EXERCISE_NAME) ?? [],
    undefined,
    { distanceMeters: RUN_LEG_DISTANCE_METERS },
    units,
    now,
  );

  const stationFeatures = {} as Record<HyroxStation, SegmentFeature>;
  for (const station of HYROX_STATION_ORDER) {
    const standard = reference.stations[station];
    stationFeatures[station] = buildSegmentFeature(
      station,
      "station",
      byExercise.get(station) ?? [],
      standard.loadKg,
      { distanceMeters: standard.distanceMeters, reps: standard.reps },
      units,
      now,
    );
  }

  // Deterministic baseline: logged median where available (load-adjusted for
  // stations), benchmark fallback otherwise. Summed across all 16 segments.
  const baselineSegments: BaselineSegmentEstimate[] = RACE_SEGMENTS.map((segment) => {
    if (segment.kind === "run") {
      const floorSeconds = reference.runKmFloorSeconds;
      // Run legs follow the cohort's real fatigue curve (run_1..run_8 get slower).
      const position = (segment.index - 1) / 2; // 1,3,…,15 → 0..7
      const curve = reference.runLegBenchmarkSeconds;
      if (runFeature.medianSeconds != null) {
        // Convert the athlete's FRESH 1 km median to a race-pace average, then
        // express it as a BOUNDED scale vs the cohort's average run and apply it
        // to the fatigue curve. Bounding keeps run splits anchored to real race
        // pacing (a fresh 4:30 can't become a 3:44 race run) while preserving
        // the athlete's relative speed and the curve's degradation shape.
        const curveMean = curve.reduce((t, v) => t + v, 0) / curve.length;
        const raceEquivMean = runFeature.medianSeconds * RUN_FATIGUE_FACTOR;
        const scale =
          curveMean > 0
            ? clamp(raceEquivMean / curveMean, MIN_PERSONAL_FRACTION, MAX_PERSONAL_FRACTION)
            : 1;
        return {
          ...segment,
          estimatedSeconds: Math.max(Math.round(curve[position] * scale), floorSeconds),
          basis: "logged" as const,
          sampleSize: runFeature.sampleSize,
          benchmarkSeconds: curve[position],
          floorSeconds,
        };
      }
      return {
        ...segment,
        estimatedSeconds: Math.max(Math.round(curve[position]), floorSeconds),
        basis: "benchmark" as const,
        sampleSize: 0,
        benchmarkSeconds: curve[position],
        floorSeconds,
      };
    }

    const station = segment.exerciseName as HyroxStation;
    const feature = stationFeatures[station];
    const floorSeconds = reference.stations[station].floorSeconds;
    if (feature.medianSeconds != null) {
      const benchmark = reference.stations[station].benchmarkSeconds;
      // Fresh logged effort → race-equivalent (load-adjusted + fatigue), then
      // bound to a band around the cohort median so a fast gym set stays a
      // realistic race split rather than surfacing the world-class floor.
      const raceEquiv =
        loadAdjust(feature.medianSeconds, feature.loadRatio) * STATION_FATIGUE_FACTOR;
      const bounded = clamp(
        raceEquiv,
        MIN_PERSONAL_FRACTION * benchmark,
        MAX_PERSONAL_FRACTION * benchmark,
      );
      return {
        ...segment,
        estimatedSeconds: Math.max(Math.round(bounded), floorSeconds),
        basis: "logged" as const,
        sampleSize: feature.sampleSize,
        benchmarkSeconds: benchmark,
        floorSeconds,
      };
    }
    return {
      ...segment,
      estimatedSeconds: Math.round(reference.stations[station].benchmarkSeconds),
      basis: "benchmark" as const,
      sampleSize: 0,
      benchmarkSeconds: reference.stations[station].benchmarkSeconds,
      floorSeconds,
    };
  });

  // Sum the 16 segments PLUS the modeled transition (roxzone) time. The latter
  // is the key fix: the old deterministic finish omitted it entirely and so
  // systematically underestimated by several minutes.
  const segmentSum = baselineSegments.reduce(
    (total, segment) => total + segment.estimatedSeconds,
    0,
  );
  const deterministicFinishSeconds = segmentSum + reference.transitionTotalSeconds;

  const stationsWithData = HYROX_STATION_ORDER.reduce(
    (count, station) => count + (stationFeatures[station].sampleSize > 0 ? 1 : 0),
    0,
  );

  return {
    division,
    resolvedGender,
    genderAssumed,
    resolvedAgeGroup,
    ageGroupAssumed,
    weightUnit,
    runFeature,
    stationFeatures,
    baselineSegments,
    transitionSeconds: reference.transitionTotalSeconds,
    deterministicFinishSeconds,
    dataCompleteness: {
      stationsWithData,
      totalStations: TOTAL_STATIONS,
      hasRunData: runFeature.sampleSize > 0,
    },
  };
}

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
 *  - run_1k is a 1 km effort, so its logged time IS the per-km split — no
 *    distance conversion needed (which avoids the stored-unit m/ft pitfall).
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
  type StoredGender,
  TOTAL_STATIONS,
} from "@shared/raceSpec";
import { type ExerciseName,normalizeExerciseName } from "@shared/schema";
import { kgToUserWeight } from "@shared/unitConversion";

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
}

export interface RacePredictionFeatures {
  division: Division;
  resolvedGender: Gender | null;
  genderAssumed: boolean;
  weightUnit: string;
  runFeature: SegmentFeature;
  stationFeatures: Record<HyroxStation, SegmentFeature>;
  baselineSegments: BaselineSegmentEstimate[];
  deterministicFinishSeconds: number;
  dataCompleteness: { stationsWithData: number; totalStations: number; hasRunData: boolean };
}

export interface AthleteProfileInput {
  division: string | null | undefined;
  gender: StoredGender;
  weightUnit: string | null | undefined;
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

interface SegmentSetMetrics {
  timesSeconds: number[];
  loads: number[];
  mostRecent: string | null;
}

function accumulateSetMetrics(sets: LoggedExerciseSetWithDate[]): SegmentSetMetrics {
  const timesSeconds: number[] = [];
  const loads: number[] = [];
  let mostRecent: string | null = null;

  for (const set of sets) {
    if (set.time != null && Number.isFinite(set.time)) {
      timesSeconds.push(set.time * 60);
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
  weightUnit: string,
  now: Date,
): SegmentFeature {
  const { timesSeconds, loads, mostRecent } = accumulateSetMetrics(sets);

  const loggedLoadUserUnit = loads.length > 0 ? Math.max(...loads) : null;
  const standardLoadUserUnit =
    standardLoadKg == null ? null : kgToUserWeight(standardLoadKg, weightUnit);
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
  const { division, resolvedGender, genderAssumed, reference } = resolveRaceReference(
    profile.division,
    profile.gender,
  );

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
    weightUnit,
    now,
  );

  const stationFeatures = {} as Record<HyroxStation, SegmentFeature>;
  for (const station of HYROX_STATION_ORDER) {
    stationFeatures[station] = buildSegmentFeature(
      station,
      "station",
      byExercise.get(station) ?? [],
      reference.stations[station].loadKg,
      weightUnit,
      now,
    );
  }

  // Deterministic baseline: logged median where available (load-adjusted for
  // stations), benchmark fallback otherwise. Summed across all 16 segments.
  const baselineSegments: BaselineSegmentEstimate[] = RACE_SEGMENTS.map((segment) => {
    if (segment.kind === "run") {
      if (runFeature.medianSeconds != null) {
        return {
          ...segment,
          estimatedSeconds: Math.round(runFeature.medianSeconds),
          basis: "logged" as const,
          sampleSize: runFeature.sampleSize,
        };
      }
      return {
        ...segment,
        estimatedSeconds: Math.round(reference.runKmBenchmarkSeconds),
        basis: "benchmark" as const,
        sampleSize: 0,
      };
    }

    const station = segment.exerciseName as HyroxStation;
    const feature = stationFeatures[station];
    if (feature.medianSeconds != null) {
      return {
        ...segment,
        estimatedSeconds: Math.round(loadAdjust(feature.medianSeconds, feature.loadRatio)),
        basis: "logged" as const,
        sampleSize: feature.sampleSize,
      };
    }
    return {
      ...segment,
      estimatedSeconds: Math.round(reference.stations[station].benchmarkSeconds),
      basis: "benchmark" as const,
      sampleSize: 0,
    };
  });

  const deterministicFinishSeconds = baselineSegments.reduce(
    (total, segment) => total + segment.estimatedSeconds,
    0,
  );

  const stationsWithData = HYROX_STATION_ORDER.reduce(
    (count, station) => count + (stationFeatures[station].sampleSize > 0 ? 1 : 0),
    0,
  );

  return {
    division,
    resolvedGender,
    genderAssumed,
    weightUnit,
    runFeature,
    stationFeatures,
    baselineSegments,
    deterministicFinishSeconds,
    dataCompleteness: {
      stationsWithData,
      totalStations: TOTAL_STATIONS,
      hasRunData: runFeature.sampleSize > 0,
    },
  };
}

/**
 * Canonical HYROX race reference data, shared by the client (Race Predictor tab)
 * and server (race-prediction engine).
 *
 * Benchmark split times, the per-run-leg fatigue curve, and transition (roxzone)
 * time are now DERIVED FROM REAL RESULTS — see shared/raceBenchmarks.generated.ts,
 * emitted by `pnpm data:race-benchmarks` from the committed results CSV. Loads,
 * dimensions, and world-class floors are rulebook/physics facts and live in
 * shared/raceConstants.ts (which this module re-exports, so existing
 * `@shared/raceSpec` importers are unaffected).
 *
 * The hand-guessed pre-dataset seeds are retained below as LEGACY_* — used only
 * as a final fallback if a cohort is somehow absent from the generated artifact,
 * and as the OLD baseline the accuracy backtest compares against.
 */
import { type CohortBenchmark, RACE_BENCHMARKS } from "./raceBenchmarks.generated";
import {
  cohortKey,
  type Division,
  type Gender,
  HYROX_STATION_ORDER,
  type HyroxStation,
  normalizeAgeGroup,
  RACE_RUN_LEGS,
  RUN_KM_FLOOR_SECONDS,
  STATION_DIMENSIONS,
  STATION_FLOOR_SECONDS,
  STATION_LOADS_KG,
  type StoredGender,
} from "./raceConstants";

// Re-export the data-independent race facts so `@shared/raceSpec` stays the
// single import site for HYROX_STATION_ORDER, RACE_SEGMENTS, floors, etc.
export * from "./raceConstants";

/**
 * LEGACY pre-dataset seeds. Kept as a safety net (cohort missing from the
 * generated artifact) and as the OLD baseline for the accuracy backtest. The
 * runtime path almost always uses the real generated benchmarks instead.
 */
export const LEGACY_STATION_BENCHMARK_SECONDS: Record<
  Division,
  Record<Gender, Record<HyroxStation, number>>
> = {
  open: {
    male: {
      skierg: 270,
      sled_push: 200,
      sled_pull: 220,
      burpee_broad_jump: 280,
      rowing: 255,
      farmers_carry: 140,
      sandbag_lunges: 280,
      wall_balls: 360,
    },
    female: {
      skierg: 300,
      sled_push: 230,
      sled_pull: 240,
      burpee_broad_jump: 320,
      rowing: 285,
      farmers_carry: 160,
      sandbag_lunges: 320,
      wall_balls: 420,
    },
  },
  pro: {
    male: {
      skierg: 255,
      sled_push: 220,
      sled_pull: 230,
      burpee_broad_jump: 260,
      rowing: 240,
      farmers_carry: 135,
      sandbag_lunges: 290,
      wall_balls: 360,
    },
    female: {
      skierg: 285,
      sled_push: 240,
      sled_pull: 245,
      burpee_broad_jump: 300,
      rowing: 270,
      farmers_carry: 150,
      sandbag_lunges: 310,
      wall_balls: 400,
    },
  },
};

export const LEGACY_RUN_KM_BENCHMARK_SECONDS: Record<Division, Record<Gender, number>> = {
  open: { male: 330, female: 372 },
  pro: { male: 270, female: 300 },
};

/** Sane transition fallback (seconds) only for the LEGACY path; the real cohorts
 *  carry their own data-derived transition total. */
const LEGACY_TRANSITION_SECONDS = 360;

export interface StationStandard {
  /**
   * External load in kg: sled total (incl. sled) for sled push/pull, per-hand
   * weight for farmers carry, sandbag weight for lunges, ball weight for wall
   * balls. Undefined for erg/bodyweight stations (skierg, rowing, burpees).
   */
  loadKg?: number;
  /** Target reps where the station is rep-based (wall balls). */
  reps?: number;
  /** Station distance in meters (erg distance, carry/sled/lunge distance, burpee distance). */
  distanceMeters?: number;
  /** Median competitive split time in seconds (cohort p50, floored). */
  benchmarkSeconds: number;
  /**
   * Fastest physically-plausible full-station split in seconds (≈ world-class).
   * A hard floor the predictor never goes below.
   */
  floorSeconds: number;
}

export interface RaceReference {
  /** Mean of the 8 run-leg medians — back-compat single-number run pace. */
  runKmBenchmarkSeconds: number;
  /** Fastest physically-plausible per-1 km run split in seconds (≈ world-class). */
  runKmFloorSeconds: number;
  /** 8 per-position run medians (run_1..run_8): the fatigue curve. */
  runLegBenchmarkSeconds: number[];
  /** Median total transition (roxzone) time across the race, in seconds. */
  transitionTotalSeconds: number;
  stations: Record<HyroxStation, StationStandard>;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((t, x) => t + x, 0) / xs.length;
}

function clampStation(station: HyroxStation, seconds: number): number {
  return Math.max(Math.round(seconds), STATION_FLOOR_SECONDS[station]);
}

function clampRun(seconds: number): number {
  return Math.max(Math.round(seconds), RUN_KM_FLOOR_SECONDS);
}

/**
 * Assemble a RaceReference for a division/gender from a real cohort benchmark.
 * Falls back to the LEGACY seeds when the cohort is missing. Loads and floors
 * are always the rulebook/physics facts (never data-derived). Every data-derived
 * split is floored so a thin cohort can't surface an impossible benchmark.
 */
function buildReferenceFromCohort(
  division: Division,
  gender: Gender,
  benchmark: CohortBenchmark | undefined,
): RaceReference {
  const stations = {} as Record<HyroxStation, StationStandard>;
  for (const station of HYROX_STATION_ORDER) {
    const benchmarkSeconds = benchmark
      ? clampStation(
          station,
          benchmark.stationP50Seconds[station] ??
            LEGACY_STATION_BENCHMARK_SECONDS[division][gender][station],
        )
      : LEGACY_STATION_BENCHMARK_SECONDS[division][gender][station];
    stations[station] = {
      ...STATION_DIMENSIONS[station],
      loadKg: STATION_LOADS_KG[division][gender][station],
      benchmarkSeconds,
      floorSeconds: STATION_FLOOR_SECONDS[station],
    };
  }

  const runLegBenchmarkSeconds = benchmark
    ? benchmark.runLegP50Seconds.map(clampRun)
    : Array.from(
        { length: RACE_RUN_LEGS },
        () => LEGACY_RUN_KM_BENCHMARK_SECONDS[division][gender],
      );

  return {
    runKmBenchmarkSeconds: Math.round(mean(runLegBenchmarkSeconds)),
    runKmFloorSeconds: RUN_KM_FLOOR_SECONDS,
    runLegBenchmarkSeconds,
    transitionTotalSeconds: benchmark
      ? benchmark.transitionTotalP50Seconds
      : LEGACY_TRANSITION_SECONDS,
    stations,
  };
}

function buildAllAgesReference(division: Division, gender: Gender): RaceReference {
  return buildReferenceFromCohort(division, gender, RACE_BENCHMARKS[cohortKey(division, gender)]);
}

export const RACE_REFERENCE: Record<Division, Record<Gender, RaceReference>> = {
  open: {
    male: buildAllAgesReference("open", "male"),
    female: buildAllAgesReference("open", "female"),
  },
  pro: {
    male: buildAllAgesReference("pro", "male"),
    female: buildAllAgesReference("pro", "female"),
  },
};

export function getRaceReference(division: Division, gender: Gender): RaceReference {
  return RACE_REFERENCE[division][gender];
}

/**
 * Neutral reference for an athlete who withheld gender: benchmark times, the run
 * curve, and transition are the mean of male/female, while loads use the male
 * (heavier) standard so the prediction stays conservative rather than optimistic.
 */
function buildBlendedReference(division: Division): RaceReference {
  const m = RACE_REFERENCE[division].male;
  const f = RACE_REFERENCE[division].female;
  const stations = {} as Record<HyroxStation, StationStandard>;
  for (const station of HYROX_STATION_ORDER) {
    stations[station] = {
      ...STATION_DIMENSIONS[station],
      loadKg: m.stations[station].loadKg,
      benchmarkSeconds: Math.round(
        (m.stations[station].benchmarkSeconds + f.stations[station].benchmarkSeconds) / 2,
      ),
      floorSeconds: m.stations[station].floorSeconds,
    };
  }
  return {
    runKmBenchmarkSeconds: Math.round((m.runKmBenchmarkSeconds + f.runKmBenchmarkSeconds) / 2),
    runKmFloorSeconds: m.runKmFloorSeconds,
    runLegBenchmarkSeconds: m.runLegBenchmarkSeconds.map((v, i) =>
      Math.round((v + (f.runLegBenchmarkSeconds[i] ?? v)) / 2),
    ),
    transitionTotalSeconds: Math.round((m.transitionTotalSeconds + f.transitionTotalSeconds) / 2),
    stations,
  };
}

export interface ResolvedRaceReference {
  division: Division;
  /** Resolved gender used for load standards, or null when the athlete withheld it. */
  resolvedGender: Gender | null;
  /** True when gender was unanswered/withheld and a neutral fallback was used. */
  genderAssumed: boolean;
  /** Canonical age band actually used, or null when an all-ages cohort was used. */
  resolvedAgeGroup: string | null;
  /** True when the athlete's specific age group was NOT applied (unknown or too thin). */
  ageGroupAssumed: boolean;
  reference: RaceReference;
}

/**
 * Resolve the reference table for a stored athlete profile. Normalizes loose
 * division/gender strings, handles the withheld-gender case with a blended
 * fallback, and applies the age-group fallback chain:
 *   (division × gender × ageGroup) → (division × gender, all ages) → blended.
 * An age cohort is only used when the generated artifact has it (i.e. it cleared
 * the sample gate); otherwise we fall back to all ages with ageGroupAssumed=true.
 */
export function resolveRaceReference(
  division: string | null | undefined,
  storedGender: StoredGender,
  ageGroup?: string | null,
): ResolvedRaceReference {
  const div: Division = division === "pro" ? "pro" : "open";

  if (storedGender === "male" || storedGender === "female") {
    const band = normalizeAgeGroup(ageGroup);
    if (band) {
      const cohort = RACE_BENCHMARKS[cohortKey(div, storedGender, band)];
      if (cohort) {
        return {
          division: div,
          resolvedGender: storedGender,
          genderAssumed: false,
          resolvedAgeGroup: band,
          ageGroupAssumed: false,
          reference: buildReferenceFromCohort(div, storedGender, cohort),
        };
      }
    }
    return {
      division: div,
      resolvedGender: storedGender,
      genderAssumed: false,
      resolvedAgeGroup: null,
      ageGroupAssumed: true,
      reference: getRaceReference(div, storedGender),
    };
  }

  return {
    division: div,
    resolvedGender: null,
    genderAssumed: true,
    resolvedAgeGroup: null,
    ageGroupAssumed: true,
    reference: buildBlendedReference(div),
  };
}

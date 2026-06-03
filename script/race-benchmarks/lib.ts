/**
 * Pure helpers for the HYROX race-benchmark tool: parse + validate a result
 * row, compute percentiles, and aggregate rows into per-cohort benchmark and
 * ranking statistics. No I/O here so it is fully unit-testable (lib.test.ts).
 *
 * The runtime predictor never imports this file — it only consumes the
 * generated artifacts this tool emits (shared/raceBenchmarks.generated.ts and
 * server/services/racePrediction/raceRankingData.generated.ts).
 */
import {
  type AgeBand,
  cohortKey,
  type Division,
  type Gender,
  HYROX_STATION_ORDER,
  normalizeAgeGroup,
  RUN_KM_FLOOR_SECONDS,
  STATION_FLOOR_SECONDS,
} from "../../shared/raceConstants";

/** An age-specific cohort needs at least this many rows to be emitted; below it
 *  the runtime resolver falls back to the division×gender (all-ages) cohort. */
export const MIN_COHORT_SAMPLE = 200;

/** Plausible HYROX singles finish range (seconds): 30 min … 3 h 20. */
const MIN_FINISH_SECONDS = 1800;
const MAX_FINISH_SECONDS = 12000;

/** Drop a row whose 24 segment splits disagree with total_time by more than this. */
const TOTAL_CONSISTENCY_TOLERANCE = 0.05;

/** Parse a "H:MM:SS" or "M:SS" clock string to whole seconds, or null. */
export function parseClockToSeconds(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const parts = raw.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.length === 3 ? nums[0] * 3600 + nums[1] * 60 + nums[2] : nums[0] * 60 + nums[1];
}

export interface ParsedRace {
  division: Division;
  gender: Gender;
  ageBand: AgeBand | null;
  /** 8 station splits in HYROX_STATION_ORDER (work_1..work_8). */
  stationSeconds: number[];
  /** 8 run-leg splits (run_1..run_8). */
  runSeconds: number[];
  /** Sum of the 8 transition (roxzone) splits. */
  transitionTotal: number;
  totalSeconds: number;
}

const sum = (xs: number[]): number => xs.reduce((t, x) => t + x, 0);

/**
 * Parse and validate one CSV record (keyed by header). Returns null for any row
 * that is not a clean singles result: non open/pro division, non male/female
 * gender, unparseable/implausible total, a missing/non-positive split, a split
 * below the world-class floor (mis-recorded), or segment splits that don't add
 * up to the stated total. roxzone_8 is legitimately 0 (no transition after the
 * final station), so transitions may be 0 but never negative.
 */
export function parseRaceRow(r: Record<string, string>): ParsedRace | null {
  const division: Division | null =
    r.division === "open" || r.division === "pro" ? r.division : null;
  if (!division) return null;
  const gender: Gender | null = r.gender === "male" || r.gender === "female" ? r.gender : null;
  if (!gender) return null;

  const totalSeconds = parseClockToSeconds(r.total_time);
  if (
    totalSeconds == null ||
    totalSeconds < MIN_FINISH_SECONDS ||
    totalSeconds > MAX_FINISH_SECONDS
  ) {
    return null;
  }

  const stationSeconds: number[] = [];
  for (let i = 0; i < 8; i++) {
    const v = parseClockToSeconds(r[`work_${i + 1}`]);
    if (v == null || v <= 0) return null;
    if (v < STATION_FLOOR_SECONDS[HYROX_STATION_ORDER[i]]) return null; // impossible/mis-recorded
    stationSeconds.push(v);
  }

  const runSeconds: number[] = [];
  for (let i = 0; i < 8; i++) {
    const v = parseClockToSeconds(r[`run_${i + 1}`]);
    if (v == null || v <= 0 || v < RUN_KM_FLOOR_SECONDS) return null;
    runSeconds.push(v);
  }

  let transitionTotal = 0;
  for (let i = 0; i < 8; i++) {
    const v = parseClockToSeconds(r[`roxzone_${i + 1}`]);
    if (v == null || v < 0) return null;
    transitionTotal += v;
  }

  const partsSum = sum(stationSeconds) + sum(runSeconds) + transitionTotal;
  if (Math.abs(partsSum - totalSeconds) > totalSeconds * TOTAL_CONSISTENCY_TOLERANCE) return null;

  return {
    division,
    gender,
    ageBand: normalizeAgeGroup(r.age_group),
    stationSeconds,
    runSeconds,
    transitionTotal,
    totalSeconds,
  };
}

/** Percentile (p in [0,100]) of an ascending-sorted array, linearly interpolated. */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (rank - lo);
}

interface CohortAccumulator {
  division: Division;
  gender: Gender;
  ageGroup: AgeBand | null;
  stations: number[][]; // 8 arrays
  runs: number[][]; // 8 arrays
  transitions: number[];
  totals: number[];
}

function emptyAccumulator(
  division: Division,
  gender: Gender,
  ageGroup: AgeBand | null,
): CohortAccumulator {
  return {
    division,
    gender,
    ageGroup,
    stations: Array.from({ length: 8 }, () => []),
    runs: Array.from({ length: 8 }, () => []),
    transitions: [],
    totals: [],
  };
}

function pushRace(acc: CohortAccumulator, race: ParsedRace): void {
  for (let i = 0; i < 8; i++) {
    acc.stations[i].push(race.stationSeconds[i]);
    acc.runs[i].push(race.runSeconds[i]);
  }
  acc.transitions.push(race.transitionTotal);
  acc.totals.push(race.totalSeconds);
}

export interface CohortBenchmark {
  division: Division;
  gender: Gender;
  /** null for the division×gender (all-ages) roll-up. */
  ageGroup: string | null;
  sampleSize: number;
  /** Median split per station, keyed by HyroxStation. */
  stationP50Seconds: Record<string, number>;
  /** 8 per-run-leg medians (run_1..run_8) — the fatigue curve. */
  runLegP50Seconds: number[];
  /** Median total transition (roxzone) time. */
  transitionTotalP50Seconds: number;
}

export interface CohortCdf {
  sampleSize: number;
  /** total_time at percentiles 1..99 (seconds), ascending. */
  finishSecondsByPercentile: number[];
}

export interface AggregationResult {
  benchmarks: Record<string, CohortBenchmark>;
  rankings: Record<string, CohortCdf>;
  meta: { usableRows: number; emittedCohorts: number; ageCohortsDropped: number };
}

/**
 * Group parsed races into cohorts and compute benchmark + ranking statistics.
 * Every division×gender roll-up is emitted; an age-specific cohort is emitted
 * only when it has at least MIN_COHORT_SAMPLE rows. Each race feeds both its
 * roll-up and (when its age band is canonical) its age cohort.
 */
export function aggregate(races: Iterable<ParsedRace>): AggregationResult {
  const accumulators = new Map<string, CohortAccumulator>();
  let usableRows = 0;

  const accFor = (
    division: Division,
    gender: Gender,
    ageGroup: AgeBand | null,
  ): CohortAccumulator => {
    const key = cohortKey(division, gender, ageGroup);
    let acc = accumulators.get(key);
    if (!acc) {
      acc = emptyAccumulator(division, gender, ageGroup);
      accumulators.set(key, acc);
    }
    return acc;
  };

  for (const race of races) {
    usableRows++;
    pushRace(accFor(race.division, race.gender, null), race);
    if (race.ageBand) pushRace(accFor(race.division, race.gender, race.ageBand), race);
  }

  const benchmarks: Record<string, CohortBenchmark> = {};
  const rankings: Record<string, CohortCdf> = {};
  let ageCohortsDropped = 0;

  for (const [key, acc] of [...accumulators.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const n = acc.totals.length;
    // All-ages roll-ups always emit; age cohorts must clear the sample gate.
    if (acc.ageGroup !== null && n < MIN_COHORT_SAMPLE) {
      ageCohortsDropped++;
      continue;
    }

    const stationP50Seconds: Record<string, number> = {};
    HYROX_STATION_ORDER.forEach((station, i) => {
      stationP50Seconds[station] = Math.round(
        percentile(
          [...acc.stations[i]].sort((x, y) => x - y),
          50,
        ),
      );
    });
    const runLegP50Seconds = acc.runs.map((arr) =>
      Math.round(
        percentile(
          [...arr].sort((x, y) => x - y),
          50,
        ),
      ),
    );
    const sortedTransitions = [...acc.transitions].sort((x, y) => x - y);
    const sortedTotals = [...acc.totals].sort((x, y) => x - y);

    benchmarks[key] = {
      division: acc.division,
      gender: acc.gender,
      ageGroup: acc.ageGroup,
      sampleSize: n,
      stationP50Seconds,
      runLegP50Seconds,
      transitionTotalP50Seconds: Math.round(percentile(sortedTransitions, 50)),
    };
    rankings[key] = {
      sampleSize: n,
      finishSecondsByPercentile: Array.from({ length: 99 }, (_, i) =>
        Math.round(percentile(sortedTotals, i + 1)),
      ),
    };
  }

  return {
    benchmarks,
    rankings,
    meta: { usableRows, emittedCohorts: Object.keys(benchmarks).length, ageCohortsDropped },
  };
}

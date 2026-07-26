/**
 * One implementation of "how long since this athlete trained each HYROX
 * station", shared by the analytics training-overview payload and the AI
 * coach's station gaps.
 *
 * These two used to be separate: `buildStationCoverage` in analyticsService
 * matched exercise keys by substring and ignored the day's focus text, while
 * `computeExerciseGaps` in coachingInsights matched exact names against its own
 * duplicate station list, kept a four-name running set, scanned focus text, and
 * counted days with different arithmetic. So the card and the coach could report
 * different numbers for the same station on the same day — which is why station
 * coverage was never put in front of an athlete.
 *
 * Kept free of drizzle so it can ship to the browser: import the deep modules
 * (`./schema/exercises`, `./raceConstants`), never the `./schema` barrel. See
 * script/bundle-check.ts.
 */
import { HYROX_STATION_ORDER, type HyroxStation } from "./raceConstants";
import {
  EXERCISE_DEFINITIONS,
  isRunningExerciseName,
  normalizeExerciseName,
} from "./schema/exercises";

/** The eight race stations plus running, which is the other half of a race. */
export type CoverageStation = HyroxStation | "running";

export const COVERAGE_STATIONS: readonly CoverageStation[] = [...HYROX_STATION_ORDER, "running"];

/**
 * Canonical exercises that count as training a station. The eight station keys
 * are themselves exercise names; the interval variants are the same movement on
 * the same machine, so they count too.
 */
const STATION_BY_EXERCISE: Readonly<Record<string, HyroxStation>> = {
  skierg: "skierg",
  ski_erg_intervals: "skierg",
  sled_push: "sled_push",
  sled_pull: "sled_pull",
  burpee_broad_jump: "burpee_broad_jump",
  rowing: "rowing",
  rowing_intervals: "rowing",
  farmers_carry: "farmers_carry",
  sandbag_lunges: "sandbag_lunges",
  wall_balls: "wall_balls",
};

/**
 * Keywords for scanning free text — a day's focus ("Sled push + wall balls") or
 * a custom exercise's label. Needed because `normalizeExerciseName` resolves
 * canonical names and registered aliases, not prose: "ski erg" normalises to
 * `ski_erg`, which is neither.
 *
 * Longest-first at match time, so "sled pull" can't be swallowed by a shorter
 * key. Ported from the coach's EXERCISE_FOCUS_MAP, which was the only place
 * this ever worked.
 */
const STATION_KEYWORDS: Readonly<Record<string, CoverageStation>> = {
  skierg: "skierg",
  "ski erg": "skierg",
  "ski-erg": "skierg",
  "sled push": "sled_push",
  "sled pull": "sled_pull",
  "burpee broad jump": "burpee_broad_jump",
  burpee: "burpee_broad_jump",
  rowing: "rowing",
  row: "rowing",
  "farmers carry": "farmers_carry",
  "farmer carry": "farmers_carry",
  "sandbag lunges": "sandbag_lunges",
  "sandbag lunge": "sandbag_lunges",
  "wall balls": "wall_balls",
  "wall ball": "wall_balls",
  running: "running",
  run: "running",
};

// Longest keyword first so "sandbag lunges" wins over "sandbag lunge" and
// "farmers carry" over "carry"-style prefixes.
const KEYWORDS_BY_LENGTH: readonly (readonly [string, CoverageStation])[] = Object.entries(
  STATION_KEYWORDS,
)
  .sort(([a], [b]) => b.length - a.length)
  .map(([keyword, station]) => [keyword, station] as const);

/** The station an exercise trains, or null when it trains none of them. */
export function stationForExerciseName(exerciseName: string): CoverageStation | null {
  const normalized = normalizeExerciseName(exerciseName);
  if (!normalized) return null;
  const station = STATION_BY_EXERCISE[normalized];
  if (station) return station;
  return isRunningExerciseName(normalized) ? "running" : null;
}

/** Stations named anywhere in a free-text string. Case-insensitive. */
export function stationsForFreeText(text: string): CoverageStation[] {
  const haystack = text.toLowerCase();
  const found = new Set<CoverageStation>();
  for (const [keyword, station] of KEYWORDS_BY_LENGTH) {
    if (haystack.includes(keyword)) found.add(station);
  }
  return [...found];
}

/** Display name for a station. "running" is not an exercise, so it is spelled out. */
export function stationLabel(station: CoverageStation): string {
  if (station === "running") return "Running";
  return EXERCISE_DEFINITIONS[station].label;
}

/** One completed session's worth of evidence about what was trained. */
export interface StationCoverageSource {
  /** YYYY-MM-DD. */
  readonly date: string;
  readonly exerciseNames: readonly string[];
  /** The day's focus, plus any custom-exercise labels — scanned by keyword. */
  readonly freeText?: readonly string[];
}

export interface StationCoverageEntry {
  readonly station: CoverageStation;
  readonly lastTrained: string | null;
  readonly daysSince: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days between two YYYY-MM-DD dates, or null when either is unusable. */
export function daysSinceDate(lastTrained: string | null, todayStr: string): number | null {
  if (!lastTrained) return null;
  const last = Date.parse(lastTrained);
  const today = Date.parse(todayStr);
  if (Number.isNaN(last) || Number.isNaN(today)) return null;
  return Math.round((today - last) / MS_PER_DAY);
}

/**
 * Days since each station was last trained, in race order with running last.
 *
 * `todayStr` is the caller's idea of today — the analytics payload counts from
 * the athlete's local calendar, the coach from UTC. That difference is
 * deliberate and stays with the callers.
 */
export function buildStationCoverage(
  sources: readonly StationCoverageSource[],
  todayStr: string,
): StationCoverageEntry[] {
  const lastTrained = new Map<CoverageStation, string>();

  const record = (station: CoverageStation, date: string) => {
    const existing = lastTrained.get(station);
    if (!existing || date > existing) lastTrained.set(station, date);
  };

  for (const source of sources) {
    if (!source.date) continue;
    for (const exerciseName of source.exerciseNames) {
      const station = stationForExerciseName(exerciseName);
      if (station) record(station, source.date);
    }
    for (const text of source.freeText ?? []) {
      if (!text) continue;
      for (const station of stationsForFreeText(text)) record(station, source.date);
    }
  }

  return COVERAGE_STATIONS.map((station) => {
    const last = lastTrained.get(station) ?? null;
    return { station, lastTrained: last, daysSince: daysSinceDate(last, todayStr) };
  });
}

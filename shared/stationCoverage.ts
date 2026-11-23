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

/** "row" or "rows" on its own: the erg, unless a strength qualifier comes right before it. */
const BARE_ROW = /\brows?\b/g;

/**
 * Keywords for scanning free text — a day's focus ("Sled push + wall balls") or
 * a custom exercise's label. Needed because `normalizeExerciseName` resolves
 * canonical names and registered aliases, not prose: "ski erg" normalises to
 * `ski_erg`, which is neither.
 *
 * Matched as whole words, with a plural allowed (D9, REFACTORING_REVIEW
 * 2026-09-23). A substring match counted "Med ball throws", "Narrow-grip
 * push-ups" and "Throwdown" as rowing and "Brunch" as running, which hid real
 * gaps on the coverage card and in the coach's EXERCISE GAPS. Hyphens and
 * underscores read as spaces, so "ski-erg" and "wall-balls" match too, and
 * apostrophes are dropped, so "farmer's carry" does. Written as literal
 * patterns rather than built from strings. Ported from the coach's
 * EXERCISE_FOCUS_MAP, which was the only place this ever worked.
 */
const STATION_PATTERNS: readonly (readonly [RegExp, CoverageStation])[] = [
  [/\bski\s*ergs?\b/g, "skierg"],
  [/\bsled\s+push(?:es)?\b/g, "sled_push"],
  [/\bsled\s+pulls?\b/g, "sled_pull"],
  // Also covers "burpee broad jump(s)".
  [/\bburpees?\b/g, "burpee_broad_jump"],
  [/\browing\b/g, "rowing"],
  [BARE_ROW, "rowing"],
  [/\bfarmers?\s+carry\b/g, "farmers_carry"],
  [/\bsandbag\s+lunges?\b/g, "sandbag_lunges"],
  [/\bwall\s+balls?\b/g, "wall_balls"],
  [/\b(?:running|runs?)\b/g, "running"],
];

/**
 * Words that, directly before "row", name a strength exercise rather than the
 * rowing station: "Bent-over rows", "Seated cable row", "DB row". Covers every
 * row in the exercise library (stationCoverage.test.ts checks this) plus the
 * common gym spellings. Only BARE_ROW is checked: "rowing" is the erg.
 */
const STRENGTH_ROW_QUALIFIER =
  /\b(?:bent over|upright|t ?bar|cable|seated|machine|inverted|pendlay|landmine|chest supported|dumbbell|db|barbell|bb|kettlebell|kb|renegade|trx|ring|band(?:ed)?|gorilla|meadows|yates|high|low|(?:single|one) arm)\s+$/;

/** Lowercase, hyphens and underscores read as spaces, apostrophes dropped ("farmer's carry"). */
function normalizeFreeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[-_]+/g, " ");
}

/** The station an exercise trains, or null when it trains none of them. */
export function stationForExerciseName(exerciseName: string): CoverageStation | null {
  const normalized = normalizeExerciseName(exerciseName);
  if (!normalized) return null;
  const station = STATION_BY_EXERCISE[normalized];
  if (station) return station;
  return isRunningExerciseName(normalized) ? "running" : null;
}

/** Whether any match of the pattern in the text names its station. */
function patternNamesStation(pattern: RegExp, haystack: string): boolean {
  for (const match of haystack.matchAll(pattern)) {
    if (pattern !== BARE_ROW) return true;
    if (!STRENGTH_ROW_QUALIFIER.test(haystack.slice(0, match.index))) return true;
  }
  return false;
}

/** Stations named anywhere in a free-text string, as whole words. Case-insensitive. */
export function stationsForFreeText(text: string): CoverageStation[] {
  const haystack = normalizeFreeText(text);
  const found = new Set<CoverageStation>();
  for (const [pattern, station] of STATION_PATTERNS) {
    if (!found.has(station) && patternNamesStation(pattern, haystack)) found.add(station);
  }
  return [...found];
}

/**
 * Stations an athlete's standing constraints plausibly rule out ("no sled at
 * my gym", "can't do burpees — wrist").
 *
 * Broader than `stationsForFreeText` on purpose: focus text names workouts
 * ("Sled Push + Wall Balls"), constraints name equipment or movements in
 * prose, so bare equipment nouns must match — and a mention of "sled" rules
 * out both sled stations at once. Word-boundary regexes, not substrings:
 * "skipping" must not read as SkiErg.
 *
 * The failure modes are deliberately asymmetric. A false match merely stops
 * the coach's gap nag for a station the athlete brought up themselves — the
 * station still exists in their constraints text, which the model sees. A
 * miss leaves the prompt contradicting itself: "EXERCISE GAPS: sled_push
 * (NEVER TRAINED — CRITICAL)" in the same context as "no sled at my gym".
 */
const CONSTRAINT_STATION_PATTERNS: readonly (readonly [RegExp, readonly CoverageStation[]])[] = [
  [/\bsleds?\b/i, ["sled_push", "sled_pull"]],
  [/\bski[\s-]?ergs?\b/i, ["skierg"]],
  [/\brow(?:ing|ers?|s)?\b/i, ["rowing"]],
  [/\bwall\s*balls?\b/i, ["wall_balls"]],
  [/\bsandbags?\b/i, ["sandbag_lunges"]],
  [/\blunges?\b/i, ["sandbag_lunges"]],
  [/\bburpees?\b/i, ["burpee_broad_jump"]],
  [/\bfarmers?\b|\bcarr(?:y|ies)\b/i, ["farmers_carry"]],
  [/\brun(?:ning|s|ners?)?\b/i, ["running"]],
];

/** Stations the constraints text rules out, or [] for empty/absent text. */
export function stationsRuledOutByConstraints(text: string | null | undefined): CoverageStation[] {
  if (!text) return [];
  const found = new Set<CoverageStation>();
  for (const [pattern, stations] of CONSTRAINT_STATION_PATTERNS) {
    if (pattern.test(text)) {
      for (const station of stations) found.add(station);
    }
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

/** Fold one session's evidence into the running last-trained-on map. */
function recordSourceStations(
  lastTrained: Map<CoverageStation, string>,
  source: StationCoverageSource,
): void {
  const record = (station: CoverageStation) => {
    const existing = lastTrained.get(station);
    if (!existing || source.date > existing) lastTrained.set(station, source.date);
  };

  for (const exerciseName of source.exerciseNames) {
    const station = stationForExerciseName(exerciseName);
    if (station) record(station);
  }
  for (const text of source.freeText ?? []) {
    if (!text) continue;
    for (const station of stationsForFreeText(text)) record(station);
  }
}

/**
 * Days since each station was last trained, in race order with running last.
 *
 * `todayStr` is the caller's idea of today. Every caller (the analytics
 * payload, the training summary and the coach's computeExerciseGaps) passes
 * the athlete's local date, so the two surfaces count gaps the same way.
 */
export function buildStationCoverage(
  sources: readonly StationCoverageSource[],
  todayStr: string,
): StationCoverageEntry[] {
  const lastTrained = new Map<CoverageStation, string>();

  for (const source of sources) {
    if (!source.date) continue;
    recordSourceStations(lastTrained, source);
  }

  return COVERAGE_STATIONS.map((station) => {
    const last = lastTrained.get(station) ?? null;
    return { station, lastTrained: last, daysSince: daysSinceDate(last, todayStr) };
  });
}

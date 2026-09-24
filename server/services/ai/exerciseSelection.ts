/**
 * The exercise-selection brief: what THIS athlete's history says about which
 * exercises belong in their training, computed deterministically so the model
 * chooses from reasons instead of from a generic menu.
 *
 * Before this existed, the plan generator was handed a flat list of ~50
 * exercise keys and the auto-coach was told to "swap in a neglected exercise"
 * with nothing to choose from. Both had the athlete's numbers but not the
 * conclusions a coach draws from them — which lifts are theirs, which pattern
 * they never train, which lift has stalled, which station they keep avoiding,
 * what their gym can't do — so every pick defaulted to the most average
 * exercise for the goal. This module draws those conclusions and attaches
 * concrete, already-filtered candidates to each one.
 *
 * Pure: every input arrives as data (both callers already hold the athlete's
 * last 70 days of sets), so plan generation, the auto-coach, chat and chat
 * plan edits all read the same brief, and it tests without mocks.
 */
import { addDaysToISODate, dayDiff } from "@shared/dateUtils";
import { HYROX_STATION_ORDER, type HyroxStation, STATION_LOADS_KG } from "@shared/raceConstants";
import {
  EXERCISE_DEFINITIONS,
  type ExerciseName,
  getExerciseMovementPatterns,
  normalizeExerciseName,
} from "@shared/schema/exercises";
import {
  convertWeight,
  getWorkoutDistanceDisplay,
  roundStoredWeight,
  standardizeWeightUnit,
  storedDistanceToDisplay,
  storedWeightToDisplay,
  type WeightUnit,
} from "@shared/unitConversion";
import { formatMinutes, minutes } from "@shared/units";

import {
  BALANCE_EXCLUDED,
  type Equipment,
  type ExperienceLevel,
  type GoalLens,
  LIFT_VARIATIONS,
  NEED_POOLS,
  PATTERN_GROUP_BY_MOVEMENT,
  PATTERN_GROUP_LABELS,
  PATTERN_GROUPS,
  type PatternGroup,
  PRIMARY_DEFAULTS,
  PRIMARY_ELIGIBLE,
  PRIMARY_SLOTS_BY_LENS,
  type PrimarySlot,
  STALL_METHODS,
  STATION_BUILDERS,
  STATION_PATTERN_GROUP,
  STATION_SUBSTITUTES,
  type StressRegion,
} from "./exerciseKnowledge";
import {
  ALL_EQUIPMENT,
  classifyGoalLens,
  type ConstraintProfile,
  isExerciseAllowed,
  parseConstraintProfile,
  STATION_KEYS,
} from "./exerciseProfile";

export type {
  Equipment,
  ExperienceLevel,
  GoalLens,
  PatternGroup,
  PrimarySlot,
  StressRegion,
} from "./exerciseKnowledge";
export {
  classifyGoalLens,
  type ConstraintProfile,
  parseConstraintProfile,
} from "./exerciseProfile";

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------

/** One logged set — the fields of `LoggedExerciseSetWithDate` this reads. */
export interface SelectionSet {
  readonly exerciseName: string;
  readonly customLabel?: string | null;
  readonly workoutLogId?: string | null;
  readonly date: string;
  readonly reps?: number | null;
  readonly weight?: number | null;
  readonly weightUnit?: string | null;
  readonly distance?: number | null;
  readonly distanceUnit?: string | null;
  readonly time?: number | null;
}

/** One upcoming planned day, reduced to what the week-shape check needs. */
export interface SelectionUpcomingDay {
  readonly date: string;
  readonly sets: readonly { readonly exerciseName: string; readonly weight?: number | null }[];
}

export interface ExerciseSelectionInput {
  /** The active plan's goal (coach), or the goal typed into the plan wizard. */
  readonly goal?: string | null;
  /** Plan-wizard focus areas: station keys, or running/strength/conditioning. */
  readonly focusAreas?: readonly string[] | null;
  readonly experienceLevel: ExperienceLevel;
  /** The athlete's standing constraints (plus, for generation, this plan's injuries). */
  readonly constraints?: string | null;
  /** The athlete's local calendar date, YYYY-MM-DD. */
  readonly today: string;
  readonly weightUnit?: string | null;
  readonly distanceUnit?: string | null;
  /** Logged TRAINING sets from the last ~70 days, any order. */
  readonly sets: readonly SelectionSet[];
  /** Days since each HYROX station (and "running") was last trained. */
  readonly stationGaps?: readonly { readonly station: string; readonly daysSince: number | null }[];
  /** The next week of planned days, for the week-shape check (coach only). */
  readonly upcoming?: readonly SelectionUpcomingDay[];
  readonly division?: string | null;
  readonly gender?: string | null;
}

/** An exercise the brief nominates, with how often the athlete has done it. */
export interface SelectionCandidate {
  readonly exercise: string;
  /** Distinct sessions in the history window; 0 = never logged. */
  readonly sessions: number;
}

/** An exercise the athlete already owns, and how their last session went. */
export interface StapleExercise {
  /** Canonical key, or `custom:<label>` for an exercise the athlete named. */
  readonly exercise: string;
  readonly sessions: number;
  readonly daysSince: number | null;
  readonly lastSession: string | null;
}

export type SelectionNeedKind =
  "focus_area" | "station_gap" | "stall" | "balance" | "missing_pattern";

/** A reason an exercise should be in the programme, with candidates for it. */
export interface SelectionNeed {
  readonly kind: SelectionNeedKind;
  readonly reason: string;
  readonly candidates: readonly SelectionCandidate[];
  readonly method?: string;
}

export interface StationSubstitution {
  readonly station: HyroxStation;
  readonly substitutes: readonly SelectionCandidate[];
}

export interface UpcomingPatternShape {
  readonly structuredDays: number;
  readonly totalDays: number;
  readonly setsByGroup: Readonly<Record<PatternGroup, number>>;
  /** Groups this goal needs that the coming week never touches. */
  readonly missing: readonly PatternGroup[];
  /** Consecutive dates that both carry heavy squat/hinge work. */
  readonly backToBackLowerBody: readonly (readonly [string, string])[];
}

export interface PrimaryLift {
  readonly slot: PrimarySlot;
  readonly exercise: ExerciseName;
  /** Sessions in the history window; 0 = a default the athlete hasn't logged. */
  readonly sessions: number;
}

export interface ExerciseSelectionBrief {
  readonly lens: GoalLens;
  readonly experienceLevel: ExperienceLevel;
  readonly staples: readonly StapleExercise[];
  readonly needs: readonly SelectionNeed[];
  readonly stationSubstitutions: readonly StationSubstitution[];
  readonly limitedRegions: readonly StressRegion[];
  readonly unavailableEquipment: readonly Equipment[];
  /** Rendered race loads for a HYROX athlete, in their weight unit. */
  readonly raceStandards: string | null;
  readonly upcomingShape: UpcomingPatternShape | null;
  /** The backbone lifts a generated plan keeps for its whole length. */
  readonly primaryLifts: readonly PrimaryLift[];
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const MAX_STAPLES = 8;
const MAX_NEEDS = 7;
const MAX_CANDIDATES = 4;
/**
 * Per-kind caps keep the ranked list diverse: without them one athlete's five
 * stale stations fill every slot and the fact that they never pull goes unsaid.
 */
const MAX_STATION_GAP_NEEDS = 2;
const MAX_STALL_NEEDS = 2;
const MAX_MISSING_PATTERN_NEEDS = 3;
/** Recent enough to describe the athlete's CURRENT habits. */
const BALANCE_WINDOW_DAYS = 28;
/** Fewer counted sets than this and a ratio is noise, not a habit. */
const MIN_BALANCE_SETS = 20;
/** Below this many sessions there are no pattern habits to read yet. */
const MIN_HISTORY_SESSIONS = 6;
const STATION_GAP_DAYS = 10;
const CRITICAL_STATION_GAP_DAYS = 14;
/** A "stall" on a light accessory is plate rounding, not a plateau. */
const MIN_STALL_WEIGHT_KG = 10;
/** Squat/hinge sets that make a planned day a heavy lower-body day. */
const HEAVY_LOWER_BODY_SETS = 4;

/** Run sessions a running focus draws on, quality first. */
const RUN_SESSION_POOL: readonly ExerciseName[] = [
  "interval_run",
  "tempo_run",
  "long_run",
  "hill_repeats",
];
/** Race-specific running for a HYROX athlete: 1 km repeats off a station. */
const HYROX_RUN_POOL: readonly ExerciseName[] = ["run_1k", "interval_run", "tempo_run", "easy_run"];

/** a1, b1, a2, b2, … — so a four-candidate cut offers both directions. */
function interleave<T>(a: readonly T[], b: readonly T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const [first, second] = [a[i], b[i]];
    if (first !== undefined) out.push(first);
    if (second !== undefined) out.push(second);
  }
  return out;
}

const GROUP_POOLS: Readonly<Record<PatternGroup, readonly ExerciseName[]>> = {
  squat: NEED_POOLS.squat,
  hinge: NEED_POOLS.hinge,
  push: interleave(NEED_POOLS.horizontal_push, NEED_POOLS.vertical_push),
  pull: interleave(NEED_POOLS.horizontal_pull, NEED_POOLS.vertical_pull),
  single_leg: NEED_POOLS.single_leg,
  carry: NEED_POOLS.carry,
  trunk: NEED_POOLS.trunk,
};

/** The pattern groups a goal cannot go four weeks without. */
const REQUIRED_GROUPS: Readonly<Record<GoalLens, readonly PatternGroup[]>> = {
  hyrox: ["single_leg", "carry", "pull", "hinge"],
  running: ["single_leg", "hinge", "trunk"],
  strength: ["squat", "hinge", "push", "pull"],
  hybrid: ["single_leg", "hinge", "pull"],
  weight_loss: ["squat", "hinge", "push", "pull", "single_leg"],
  general: ["squat", "hinge", "push", "pull", "single_leg", "trunk"],
};

/** Why a goal needs a pattern — the reason the athlete will read back. */
const GROUP_REASONS: Readonly<Partial<Record<GoalLens, Partial<Record<PatternGroup, string>>>>> = {
  hyrox: {
    single_leg: "leg endurance for the sandbag lunges",
    carry: "grip and trunk for the farmers carry and sled pull",
    pull: "pulling strength for the sled pull, row and SkiErg",
    hinge: "posterior chain for sled work and rowing",
  },
  running: {
    single_leg: "running is single-leg: this is what protects knees and hips",
    hinge: "posterior-chain strength drives stride power",
    trunk: "trunk stiffness keeps form together late in a run",
  },
  hybrid: {
    single_leg: "single-leg strength carries straight over to running",
    hinge: "posterior-chain strength for stride power",
    pull: "keeps the upper body balanced against pressing",
  },
};

const CALF_EXERCISES: ReadonlySet<string> = new Set<ExerciseName>([
  ...NEED_POOLS.calves_feet,
  "calf_raise",
]);

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

interface DisplayUnits {
  readonly weightUnit: WeightUnit;
  readonly distanceUnit: string;
}

interface SessionSummary {
  readonly date: string;
  setCount: number;
  topWeight: number | null;
  repsAtTop: number | null;
  firstReps: number | null;
  distance: number;
  time: number;
}

interface ExerciseHistory {
  readonly exercise: string;
  readonly canonical: ExerciseName | null;
  readonly sessions: Map<string, SessionSummary>;
}

/** Canonical key, `custom:<label>`, or null for rows that name no exercise. */
function exerciseKey(set: SelectionSet): { key: string; canonical: ExerciseName | null } | null {
  const canonical = normalizeExerciseName(set.exerciseName);
  if (canonical && canonical !== "custom") {
    // A format, not an exercise: "EMOM" says nothing about what was trained.
    if (canonical === "emom" || canonical === "amrap") return null;
    return { key: canonical, canonical };
  }
  const label = set.customLabel?.trim();
  return label ? { key: `custom:${label}`, canonical: null } : null;
}

function foldWeight(summary: SessionSummary, weight: number, reps: number | null): void {
  if (summary.topWeight == null || weight > summary.topWeight) {
    summary.topWeight = weight;
    summary.repsAtTop = reps;
  } else if (weight === summary.topWeight && reps != null && reps > (summary.repsAtTop ?? 0)) {
    summary.repsAtTop = reps;
  }
}

function foldSet(summary: SessionSummary, set: SelectionSet, units: DisplayUnits): void {
  summary.setCount += 1;
  const reps = set.reps ?? null;
  summary.firstReps ??= reps;
  if (set.weight != null && set.weight > 0) {
    foldWeight(
      summary,
      storedWeightToDisplay(set.weight, { weightUnit: set.weightUnit }, units),
      reps,
    );
  }
  if (set.distance != null && set.distance > 0) {
    summary.distance += storedDistanceToDisplay(
      set.distance,
      { distanceUnit: set.distanceUnit },
      units,
    );
  }
  if (set.time != null && set.time > 0) summary.time += set.time;
}

function emptySession(date: string): SessionSummary {
  return {
    date,
    setCount: 0,
    topWeight: null,
    repsAtTop: null,
    firstReps: null,
    distance: 0,
    time: 0,
  };
}

function collectHistory(
  sets: readonly SelectionSet[],
  units: DisplayUnits,
): Map<string, ExerciseHistory> {
  const histories = new Map<string, ExerciseHistory>();
  for (const set of sets) {
    const resolved = set.date ? exerciseKey(set) : null;
    if (!resolved) continue;
    let history = histories.get(resolved.key);
    if (!history) {
      history = { exercise: resolved.key, canonical: resolved.canonical, sessions: new Map() };
      histories.set(resolved.key, history);
    }
    // Keyed on the log as well as the date: two sessions on one day are two
    // sessions, and a set with no log id still groups by its date.
    const sessionId = `${set.workoutLogId ?? ""}|${set.date}`;
    let session = history.sessions.get(sessionId);
    if (!session) {
      session = emptySession(set.date);
      history.sessions.set(sessionId, session);
    }
    foldSet(session, set, units);
  }
  return histories;
}

function sessionsOldestFirst(history: ExerciseHistory): SessionSummary[] {
  return [...history.sessions.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function formatWeight(value: number, unit: WeightUnit): string {
  return `${roundStoredWeight(value, unit)} ${unit}`;
}

/** "4 sets, top 100 kg x 5" · "8000 m in 42min" · "3 sets of 12". */
function describeSession(session: SessionSummary, units: DisplayUnits): string | null {
  const sets = `${session.setCount} set${session.setCount === 1 ? "" : "s"}`;
  if (session.topWeight != null) {
    const reps = session.repsAtTop == null ? "" : ` x ${session.repsAtTop}`;
    return `${sets}, top ${formatWeight(session.topWeight, units.weightUnit)}${reps}`;
  }
  if (session.distance > 0) {
    const distance = getWorkoutDistanceDisplay(session.distance, units.distanceUnit).text;
    return session.time > 0 ? `${distance} in ${formatMinutes(minutes(session.time))}` : distance;
  }
  if (session.time > 0) return formatMinutes(minutes(session.time));
  return session.firstReps == null ? null : `${sets} of ${session.firstReps}`;
}

function buildStaples(
  histories: Map<string, ExerciseHistory>,
  today: string,
  units: DisplayUnits,
): StapleExercise[] {
  const staples: (StapleExercise & { lastDate: string })[] = [];
  for (const history of histories.values()) {
    if (history.sessions.size < 2) continue;
    const last = sessionsOldestFirst(history).at(-1);
    if (!last) continue;
    staples.push({
      exercise: history.exercise,
      sessions: history.sessions.size,
      daysSince: Math.max(0, dayDiff(last.date, today)),
      lastSession: describeSession(last, units),
      lastDate: last.date,
    });
  }
  return staples
    .sort((a, b) => b.sessions - a.sessions || b.lastDate.localeCompare(a.lastDate))
    .slice(0, MAX_STAPLES)
    .map(({ lastDate: _lastDate, ...staple }) => staple);
}

function totalSessions(histories: Map<string, ExerciseHistory>): number {
  const sessionIds = new Set<string>();
  for (const history of histories.values()) {
    for (const id of history.sessions.keys()) sessionIds.add(id);
  }
  return sessionIds.size;
}

// ---------------------------------------------------------------------------
// Candidate ranking
// ---------------------------------------------------------------------------

interface SelectionScope {
  readonly profile: ConstraintProfile;
  readonly experience: ExperienceLevel;
  readonly histories: Map<string, ExerciseHistory>;
}

function sessionsFor(scope: SelectionScope, exercise: string): number {
  return scope.histories.get(exercise)?.sessions.size ?? 0;
}

/**
 * Filter a pool to what this athlete can do and order it familiar-first. The
 * sort is stable, so among exercises they have never logged the pool's own
 * order (most broadly useful first) is kept.
 */
function rankCandidates(
  scope: SelectionScope,
  pool: readonly string[],
  exclude: ReadonlySet<string> = new Set(),
): SelectionCandidate[] {
  const seen = new Set<string>();
  const candidates: SelectionCandidate[] = [];
  for (const exercise of pool) {
    if (seen.has(exercise) || exclude.has(exercise)) continue;
    seen.add(exercise);
    const sessions = sessionsFor(scope, exercise);
    if (isExerciseAllowed(exercise, scope.profile, scope.experience, sessions > 0)) {
      candidates.push({ exercise, sessions });
    }
  }
  return candidates.sort((a, b) => b.sessions - a.sessions).slice(0, MAX_CANDIDATES);
}

/** Display name for a canonical key or a `custom:<label>` key. */
export function selectionExerciseLabel(exercise: string): string {
  if (exercise.startsWith("custom:")) return exercise.slice("custom:".length);
  return EXERCISE_DEFINITIONS[exercise as ExerciseName]?.label ?? exercise;
}

function coverageLabel(station: HyroxStation | "running"): string {
  return station === "running" ? "Running" : EXERCISE_DEFINITIONS[station].label;
}

// ---------------------------------------------------------------------------
// Needs
// ---------------------------------------------------------------------------

interface RankedNeed extends SelectionNeed {
  /** Lower sorts first. */
  readonly priority: number;
}

function stationNeedCandidates(scope: SelectionScope, station: HyroxStation): SelectionCandidate[] {
  const stationOnly = new Set<string>([station]);
  const own = rankCandidates(scope, [station]).at(0);
  if (!own) {
    // The station itself is ruled out: prepare for it with substitutes that
    // load the same muscles in the same direction.
    return rankCandidates(
      scope,
      [...STATION_SUBSTITUTES[station], ...STATION_BUILDERS[station]],
      stationOnly,
    );
  }
  // The station stays first even when a builder is more familiar: closing a
  // station gap with its accessories alone is how an athlete reaches race day
  // never having pushed a sled.
  return [
    own,
    ...rankCandidates(scope, STATION_BUILDERS[station], stationOnly).slice(0, MAX_CANDIDATES - 1),
  ];
}

const FOCUS_POOLS: Readonly<Record<string, readonly ExerciseName[]>> = {
  running: RUN_SESSION_POOL,
  strength: [
    ...PRIMARY_DEFAULTS.squat.standard,
    ...PRIMARY_DEFAULTS.hinge.standard,
    ...PRIMARY_DEFAULTS.pull.standard,
  ],
  conditioning: NEED_POOLS.engine,
};

function focusAreaNeed(scope: SelectionScope, area: string): RankedNeed | null {
  const station = STATION_KEYS.has(area) ? (area as HyroxStation) : null;
  const pool = station ? null : FOCUS_POOLS[area];
  if (!station && !pool) return null;
  const candidates = station
    ? stationNeedCandidates(scope, station)
    : rankCandidates(scope, pool ?? []);
  if (candidates.length === 0) return null;
  const label = station ? coverageLabel(station) : area;
  return {
    kind: "focus_area",
    priority: 1,
    reason: `${label}: the athlete chose this as a focus area — give it a recurring, progressing slot`,
    candidates,
  };
}

function resolveCoverageStation(raw: string): HyroxStation | "running" | null {
  if (raw === "running") return "running";
  const normalized = normalizeExerciseName(raw);
  return normalized && STATION_KEYS.has(normalized) ? (normalized as HyroxStation) : null;
}

interface StaleStation {
  readonly station: HyroxStation | "running";
  readonly daysSince: number | null;
}

function staleStations(
  gaps: NonNullable<ExerciseSelectionInput["stationGaps"]>,
  hasHistory: boolean,
  alreadyCovered: ReadonlySet<string>,
): StaleStation[] {
  const stale: StaleStation[] = [];
  for (const gap of gaps) {
    const station = resolveCoverageStation(gap.station);
    if (!station || alreadyCovered.has(station)) continue;
    // "Never trained" is only a signal once there is history it could have
    // been trained in; for a brand-new athlete every station is "never".
    const isStale = gap.daysSince == null ? hasHistory : gap.daysSince >= STATION_GAP_DAYS;
    if (isStale) stale.push({ station, daysSince: gap.daysSince });
  }
  const staleness = (gap: StaleStation) => gap.daysSince ?? Number.POSITIVE_INFINITY;
  return stale.sort((a, b) => staleness(b) - staleness(a)).slice(0, MAX_STATION_GAP_NEEDS);
}

function stationGapNeed(scope: SelectionScope, gap: StaleStation): RankedNeed | null {
  // A station the athlete's constraints rule out is not a gap to close; the
  // brief's substitutes line already says what trains its demand instead.
  if (
    gap.station !== "running" &&
    !isExerciseAllowed(gap.station, scope.profile, scope.experience, true)
  )
    return null;
  const candidates =
    gap.station === "running"
      ? rankCandidates(scope, HYROX_RUN_POOL)
      : stationNeedCandidates(scope, gap.station);
  if (candidates.length === 0) return null;
  const since =
    gap.daysSince == null ? "no recent session on record" : `not trained for ${gap.daysSince} days`;
  const critical = gap.daysSince == null || gap.daysSince >= CRITICAL_STATION_GAP_DAYS;
  return {
    kind: "station_gap",
    priority: critical ? 2 : 4,
    reason: `${coverageLabel(gap.station)}: ${since}`,
    candidates,
  };
}

function primaryPoolFor(exercise: ExerciseName): readonly ExerciseName[] {
  const pattern = getExerciseMovementPatterns(exercise).at(0);
  return pattern ? GROUP_POOLS[PATTERN_GROUP_BY_MOVEMENT[pattern]] : [];
}

/**
 * The same top load for the last three sessions, with no more reps at it than
 * the first of them. Same load with MORE reps is double progression working,
 * not a stall.
 */
function stalledAt(history: ExerciseHistory, minWeight: number): SessionSummary | null {
  if (!history.canonical || history.sessions.size < 3) return null;
  const lastThree = sessionsOldestFirst(history).slice(-3);
  const first = lastThree.at(0);
  const last = lastThree.at(-1);
  const load = first?.topWeight;
  if (!first || !last || load == null || load < minWeight) return null;
  const sameLoad = lastThree.every(
    (session) => session.topWeight != null && Math.abs(session.topWeight - load) < 0.01,
  );
  const repsGained = (last.repsAtTop ?? 0) > (first.repsAtTop ?? 0);
  return sameLoad && !repsGained ? last : null;
}

function stallNeeds(scope: SelectionScope, units: DisplayUnits): RankedNeed[] {
  const minWeight = convertWeight(MIN_STALL_WEIGHT_KG, "kg", units.weightUnit);
  const stalls: { need: RankedNeed; lastDate: string }[] = [];
  for (const history of scope.histories.values()) {
    const last = stalledAt(history, minWeight);
    const canonical = history.canonical;
    if (!last || !canonical || last.topWeight == null) continue;
    const variations = LIFT_VARIATIONS[canonical] ?? primaryPoolFor(canonical);
    const reps = last.repsAtTop == null ? "" : ` x ${last.repsAtTop}`;
    stalls.push({
      lastDate: last.date,
      need: {
        kind: "stall",
        priority: 3,
        reason: `${selectionExerciseLabel(canonical)} has stalled at ${formatWeight(last.topWeight, units.weightUnit)}${reps} for 3 sessions`,
        candidates: rankCandidates(scope, variations, new Set([canonical])),
        method: STALL_METHODS,
      },
    });
  }
  return stalls
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate))
    .slice(0, MAX_STALL_NEEDS)
    .map((stall) => stall.need);
}

function patternGroupsOf(exerciseName: string): Set<PatternGroup> | null {
  const canonical = normalizeExerciseName(exerciseName);
  if (!canonical || BALANCE_EXCLUDED.has(canonical)) return null;
  if (EXERCISE_DEFINITIONS[canonical].category === "running") return null;
  return new Set(
    getExerciseMovementPatterns(canonical).map((pattern) => PATTERN_GROUP_BY_MOVEMENT[pattern]),
  );
}

function zeroGroupCounts(): Record<PatternGroup, number> {
  return { squat: 0, hinge: 0, push: 0, pull: 0, single_leg: 0, carry: 0, trunk: 0 };
}

/** Sets per pattern group since `since`, strength patterns only. */
function countGroupSets(
  sets: readonly SelectionSet[],
  since: string,
): Record<PatternGroup, number> {
  const counts = zeroGroupCounts();
  for (const set of sets) {
    if (!set.date || set.date < since) continue;
    for (const group of patternGroupsOf(set.exerciseName) ?? []) counts[group] += 1;
  }
  return counts;
}

function missingPatternNeed(
  scope: SelectionScope,
  group: PatternGroup,
  lens: GoalLens,
): RankedNeed {
  const why = GROUP_REASONS[lens]?.[group];
  return {
    kind: "missing_pattern",
    // As urgent as a critical station gap: four weeks without a whole pattern
    // the goal depends on is a hole in the programme, not a detail.
    priority: 2,
    reason: `No ${PATTERN_GROUP_LABELS[group]} work in the last 4 weeks${why ? ` (${why})` : ""}`,
    candidates: rankCandidates(scope, GROUP_POOLS[group]),
  };
}

function calfNeed(
  scope: SelectionScope,
  sets: readonly SelectionSet[],
  lens: GoalLens,
  since: string,
): RankedNeed | null {
  if (lens !== "running" && lens !== "hybrid") return null;
  const trainsCalves = sets.some(
    (set) => set.date >= since && CALF_EXERCISES.has(normalizeExerciseName(set.exerciseName) ?? ""),
  );
  if (trainsCalves) return null;
  return {
    kind: "missing_pattern",
    priority: 4,
    reason:
      "No calf or foot strength in the last 4 weeks (the lower leg absorbs the most load in running)",
    candidates: rankCandidates(scope, NEED_POOLS.calves_feet),
  };
}

/**
 * Lopsided habits, once there are enough sets for a ratio to mean anything.
 * A pattern with no sets at all is the missing-pattern need's job when the
 * goal requires it, so the ratios only speak about patterns that exist.
 */
function ratioNeeds(
  scope: SelectionScope,
  counts: Record<PatternGroup, number>,
  alreadyMissing: ReadonlySet<PatternGroup>,
): RankedNeed[] {
  const total = PATTERN_GROUPS.reduce((sum, group) => sum + counts[group], 0);
  if (total < MIN_BALANCE_SETS) return [];
  const needs: RankedNeed[] = [];
  if (counts.pull > 0 && counts.push >= 8 && counts.pull < counts.push * 0.7) {
    needs.push({
      kind: "balance",
      priority: 3,
      reason: `Pulling is ${counts.pull} sets vs ${counts.push} pushing sets in the last 4 weeks`,
      candidates: rankCandidates(scope, GROUP_POOLS.pull),
    });
  }
  if (counts.hinge > 0 && counts.squat >= 8 && counts.hinge < counts.squat * 0.5) {
    needs.push({
      kind: "balance",
      priority: 3,
      reason: `Hinge / posterior-chain work is ${counts.hinge} sets vs ${counts.squat} squat sets in the last 4 weeks`,
      candidates: rankCandidates(scope, GROUP_POOLS.hinge),
    });
  }
  const bilateral = counts.squat + counts.hinge;
  if (!alreadyMissing.has("single_leg") && counts.single_leg === 0 && bilateral >= 10) {
    needs.push({
      kind: "balance",
      priority: 3,
      reason: `All ${bilateral} lower-body sets in the last 4 weeks were two-legged — no single-leg work`,
      candidates: rankCandidates(scope, GROUP_POOLS.single_leg),
    });
  }
  return needs;
}

function balanceNeeds(
  scope: SelectionScope,
  sets: readonly SelectionSet[],
  lens: GoalLens,
  since: string,
  coveredByStations: ReadonlySet<PatternGroup>,
): RankedNeed[] {
  const counts = countGroupSets(sets, since);
  const missingGroups = REQUIRED_GROUPS[lens].filter((group) => counts[group] === 0);
  const calves = calfNeed(scope, sets, lens, since);
  return [
    ...missingGroups
      .filter((group) => !coveredByStations.has(group))
      .slice(0, MAX_MISSING_PATTERN_NEEDS)
      .map((group) => missingPatternNeed(scope, group, lens)),
    ...(calves ? [calves] : []),
    ...ratioNeeds(scope, counts, new Set(missingGroups)),
  ].filter((need) => need.candidates.length > 0);
}

// ---------------------------------------------------------------------------
// Stations the constraints rule out
// ---------------------------------------------------------------------------

function stationSubstitutions(scope: SelectionScope): StationSubstitution[] {
  const substitutions: StationSubstitution[] = [];
  for (const station of HYROX_STATION_ORDER) {
    if (isExerciseAllowed(station, scope.profile, scope.experience, true)) continue;
    const substitutes = rankCandidates(scope, STATION_SUBSTITUTES[station]);
    if (substitutes.length > 0) substitutions.push({ station, substitutes });
  }
  return substitutions;
}

// ---------------------------------------------------------------------------
// Race standards
// ---------------------------------------------------------------------------

const STANDARD_STATIONS: readonly (readonly [HyroxStation, string])[] = [
  ["sled_push", "sled push"],
  ["sled_pull", "sled pull"],
  ["farmers_carry", "farmers carry 2 x"],
  ["sandbag_lunges", "sandbag lunges"],
  ["wall_balls", "wall balls"],
];

/**
 * The loads the athlete will race with, in their unit, so "sled push at 80% of
 * race load" is a number the model can work out rather than guess. With gender
 * withheld both categories are shown.
 */
function describeRaceStandards(
  division: string | null | undefined,
  gender: string | null | undefined,
  weightUnit: WeightUnit,
): string {
  const div = division === "pro" ? "pro" : "open";
  const load = (kg: number | undefined) =>
    kg == null ? "?" : String(roundStoredWeight(convertWeight(kg, "kg", weightUnit), weightUnit));
  if (gender === "male" || gender === "female") {
    const loads = STATION_LOADS_KG[div][gender];
    const parts = STANDARD_STATIONS.map(
      ([station, label]) => `${label} ${load(loads[station])} ${weightUnit}`,
    );
    return `${div}, ${gender === "male" ? "men" : "women"}: ${parts.join(" · ")}`;
  }
  const women = STATION_LOADS_KG[div].female;
  const men = STATION_LOADS_KG[div].male;
  const parts = STANDARD_STATIONS.map(
    ([station, label]) => `${label} ${load(women[station])} / ${load(men[station])} ${weightUnit}`,
  );
  return `${div}, women / men (gender not set): ${parts.join(" · ")}`;
}

// ---------------------------------------------------------------------------
// Upcoming week shape (auto-coach)
// ---------------------------------------------------------------------------

function tallyDay(day: SelectionUpcomingDay, setsByGroup: Record<PatternGroup, number>): number {
  let heavyLower = 0;
  for (const set of day.sets) {
    const groups = patternGroupsOf(set.exerciseName);
    if (!groups) continue;
    for (const group of groups) setsByGroup[group] += 1;
    if ((groups.has("squat") || groups.has("hinge")) && (set.weight ?? 0) > 0) heavyLower += 1;
  }
  return heavyLower;
}

function consecutivePairs(dates: readonly string[]): (readonly [string, string])[] {
  const sorted = [...new Set(dates)].sort((a, b) => a.localeCompare(b));
  const pairs: (readonly [string, string])[] = [];
  sorted.forEach((date, index) => {
    const previous = index > 0 ? sorted[index - 1] : undefined;
    if (previous && dayDiff(previous, date) === 1) pairs.push([previous, date]);
  });
  return pairs;
}

function buildUpcomingShape(
  upcoming: readonly SelectionUpcomingDay[],
  lens: GoalLens,
): UpcomingPatternShape | null {
  const structured = upcoming.filter((day) => day.sets.length > 0);
  if (structured.length < 2) return null;

  const setsByGroup = zeroGroupCounts();
  const heavyLowerDates = structured
    .filter((day) => tallyDay(day, setsByGroup) >= HEAVY_LOWER_BODY_SETS)
    .map((day) => day.date);

  return {
    structuredDays: structured.length,
    totalDays: upcoming.length,
    setsByGroup,
    missing: REQUIRED_GROUPS[lens].filter((group) => setsByGroup[group] === 0),
    backToBackLowerBody: consecutivePairs(heavyLowerDates),
  };
}

// ---------------------------------------------------------------------------
// Primary lifts (plan backbone)
// ---------------------------------------------------------------------------

function defaultsFor(
  slot: PrimarySlot,
  lens: GoalLens,
  experience: ExperienceLevel,
): ExerciseName[] {
  const defaults = PRIMARY_DEFAULTS[slot];
  return [
    ...(experience === "beginner" ? (defaults.beginner ?? []) : []),
    ...(defaults[lens] ?? []),
    ...defaults.standard,
  ];
}

function familiarPrimary(
  scope: SelectionScope,
  slot: PrimarySlot,
  used: ReadonlySet<string>,
): PrimaryLift | null {
  let best: PrimaryLift | null = null;
  for (const exercise of PRIMARY_ELIGIBLE[slot]) {
    const sessions = sessionsFor(scope, exercise);
    if (sessions < 2 || used.has(exercise)) continue;
    if (!isExerciseAllowed(exercise, scope.profile, scope.experience, true)) continue;
    if (!best || sessions > best.sessions) best = { slot, exercise, sessions };
  }
  return best;
}

/**
 * One backbone lift per slot for the whole plan: the athlete's most-practised
 * lift for that slot when they have one, otherwise the first default their
 * constraints, equipment and experience allow. Holding these fixed is what
 * lets loads progress against the anchors, and what makes a plan generated in
 * parallel chunks read as one programme.
 */
function choosePrimaryLifts(scope: SelectionScope, lens: GoalLens): PrimaryLift[] {
  const used = new Set<string>();
  const lifts: PrimaryLift[] = [];
  for (const slot of PRIMARY_SLOTS_BY_LENS[lens]) {
    const lift = familiarPrimary(scope, slot, used) ?? defaultPrimary(scope, slot, lens, used);
    if (!lift) continue;
    used.add(lift.exercise);
    lifts.push(lift);
  }
  return lifts;
}

function defaultPrimary(
  scope: SelectionScope,
  slot: PrimarySlot,
  lens: GoalLens,
  used: ReadonlySet<string>,
): PrimaryLift | null {
  const exercise = defaultsFor(slot, lens, scope.experience).find(
    (candidate) =>
      !used.has(candidate) && isExerciseAllowed(candidate, scope.profile, scope.experience, false),
  );
  return exercise ? { slot, exercise, sessions: sessionsFor(scope, exercise) } : null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function rankNeeds(needs: readonly RankedNeed[]): SelectionNeed[] {
  return needs
    .map((need, order) => ({ need, order }))
    .sort((a, b) => a.need.priority - b.need.priority || a.order - b.order)
    .slice(0, MAX_NEEDS)
    .map(({ need: { priority: _priority, ...need } }) => need);
}

export function buildExerciseSelectionBrief(input: ExerciseSelectionInput): ExerciseSelectionBrief {
  const units: DisplayUnits = {
    weightUnit: standardizeWeightUnit(input.weightUnit),
    distanceUnit: input.distanceUnit ?? "km",
  };
  const lens = classifyGoalLens(input.goal, input.focusAreas);
  const profile = parseConstraintProfile(input.constraints);
  const histories = collectHistory(input.sets, units);
  const scope: SelectionScope = { profile, experience: input.experienceLevel, histories };
  const hasHistory = totalSessions(histories) >= MIN_HISTORY_SESSIONS;
  const since = addDaysToISODate(input.today, -(BALANCE_WINDOW_DAYS - 1));

  const focusAreas = input.focusAreas ?? [];
  const stationsMatter = lens === "hyrox" || focusAreas.some((area) => STATION_KEYS.has(area));
  const focusNeeds = focusAreas.flatMap((area) => focusAreaNeed(scope, area) ?? []);
  const staleGaps = stationsMatter
    ? staleStations(input.stationGaps ?? [], hasHistory, new Set(focusAreas))
    : [];
  const gapNeeds = staleGaps.flatMap((gap) => stationGapNeed(scope, gap) ?? []);
  const coveredByStations = new Set(
    [...staleGaps.map((gap) => gap.station), ...focusAreas].flatMap(
      (station) => STATION_PATTERN_GROUP[station as HyroxStation] ?? [],
    ),
  );

  return {
    lens,
    experienceLevel: input.experienceLevel,
    staples: buildStaples(histories, input.today, units),
    needs: rankNeeds([
      ...focusNeeds,
      ...gapNeeds,
      ...stallNeeds(scope, units),
      ...(hasHistory ? balanceNeeds(scope, input.sets, lens, since, coveredByStations) : []),
    ]),
    stationSubstitutions: stationsMatter ? stationSubstitutions(scope) : [],
    limitedRegions: [...profile.regions],
    unavailableEquipment: ALL_EQUIPMENT.filter((equipment) => profile.unavailable.has(equipment)),
    raceStandards:
      lens === "hyrox"
        ? describeRaceStandards(input.division, input.gender, units.weightUnit)
        : null,
    upcomingShape: input.upcoming ? buildUpcomingShape(input.upcoming, lens) : null,
    primaryLifts: choosePrimaryLifts(scope, lens),
  };
}

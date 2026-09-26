/**
 * Running targets from the athlete's own runs: training paces fitted to their
 * best recent effort, and a week-by-week volume and long-run progression that
 * starts from what they actually run now.
 *
 * Paces use Jack Daniels' VDOT model: one effort (distance in time) gives an
 * aerobic fitness number, and each training zone is a fixed fraction of it.
 * It is the model most running coaches prescribe from, it needs nothing but
 * distance and time, and — unlike a flat "median pace x factor" — it knows
 * that 5 km in 25 minutes and 10 km in 52 minutes are the same athlete.
 *
 * Deliberately conservative: an easy run read as an effort UNDER-states
 * fitness (easy pace sits around 70% of it), so an athlete who has only run
 * easily gets paces on the slow side, never on the injurious one. As soon as
 * they log a harder run, the estimate rises to meet it.
 */
import { addDaysToISODate } from "@shared/dateUtils";
import type { TrainingPhase } from "@shared/nutritionTargets";
import { storedDistanceToMetersStamped } from "@shared/unitConversion";

import type { ExperienceLevel, GoalLens } from "../ai/exerciseKnowledge";
import type { PlanWeekOutline } from "../planBlueprint";
import type { EngineSet } from "./loadMath";

/** The fields of a workout log the running engine reads; `WorkoutLog` satisfies it. */
export interface EngineRunLog {
  readonly id?: string | null;
  readonly date: string;
  readonly focus?: string | null;
  readonly distanceMeters?: number | null;
  /** Moving time in minutes. */
  readonly duration?: number | null;
  /** Metres per second. */
  readonly avgSpeed?: number | null;
  readonly countsAsTraining?: boolean | null;
}

export interface RunEffort {
  readonly date: string;
  readonly meters: number;
  readonly seconds: number;
}

/** Training paces in seconds per kilometre. */
export interface RunPaceZones {
  readonly vdot: number;
  /** The effort the zones were fitted to. */
  readonly basis: RunEffort;
  readonly easy: { readonly fast: number; readonly slow: number };
  /** Marathon / steady pace: long-run finishes, HYROX race-run pace. */
  readonly steady: number;
  readonly threshold: number;
  readonly interval: number;
  readonly repetition: number;
}

export interface RunVolumeBaseline {
  /** Average kilometres per week over the last four weeks. */
  readonly weeklyKm: number;
  readonly longestRunKm: number;
  readonly runsPerWeek: number;
}

export interface RunWeekTarget {
  readonly week: number;
  readonly phase: TrainingPhase;
  readonly deload: boolean;
  readonly weeklyKm: number;
  readonly longRunKm: number;
}

// Strava/Garmin set a log's focus to the sport type ("Run", "TrailRun").
const RUN_FOCUS = /run/i;
const RUN_SET_EXERCISES: ReadonlySet<string> = new Set([
  "run",
  "run_1k",
  "easy_run",
  "recovery_run",
  "tempo_run",
  "interval_run",
  "long_run",
  "treadmill_run",
  "fartlek_run",
]);
// Same plausibility band as sessionEstimate/runPace: the ceiling removes
// mis-tagged rides, the floor keeps genuinely slow runners.
const MIN_RUN_SPEED_MS = 1.1;
const MAX_RUN_SPEED_MS = 6.5;
/** Shorter than this and GPS noise or a sprint decides the number. */
const MIN_EFFORT_METERS = 800;
const MIN_EFFORT_SECONDS = 180;
/** Two efforts at least: one is one bad GPS trace away from a wrong zone. */
const MIN_EFFORTS = 2;
/** A "best" this far above the athlete's typical effort is a mis-tagged ride, not a run. */
const MAX_BEST_OVER_MEDIAN = 1.45;
const MIN_VDOT = 15;
const MAX_VDOT = 85;
const VOLUME_WINDOW_DAYS = 28;

// Zone fractions of VDOT, from Daniels' Running Formula. Exported for session
// grading (sessionGrades/targets.ts), which measures a run against the same zones.
export const EASY_FAST = 0.7;
export const EASY_SLOW = 0.62;
const STEADY = 0.82;
export const THRESHOLD = 0.88;
const INTERVAL = 0.975;
const REPETITION = 1.055;

function vo2AtVelocity(metersPerMin: number): number {
  return -4.6 + 0.182258 * metersPerMin + 0.000104 * metersPerMin * metersPerMin;
}

/** The fraction of VO2max an athlete can hold for this many minutes. */
function sustainableFraction(minutes: number): number {
  return (
    0.8 + 0.1894393 * Math.exp(-0.012778 * minutes) + 0.2989558 * Math.exp(-0.1932605 * minutes)
  );
}

export function vdotFromEffort(meters: number, seconds: number): number {
  const minutes = seconds / 60;
  return vo2AtVelocity(meters / minutes) / sustainableFraction(minutes);
}

/** Seconds per kilometre at a fraction of VDOT: the VO2 curve solved for speed. */
export function paceAtFraction(vdot: number, fraction: number): number {
  const a = 0.000104;
  const b = 0.182258;
  const c = -(4.6 + vdot * fraction);
  const metersPerMin = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return (1000 / metersPerMin) * 60;
}

function plausible(meters: number, seconds: number): boolean {
  if (meters <= 0 || seconds <= 0) return false;
  const speed = meters / seconds;
  return speed >= MIN_RUN_SPEED_MS && speed <= MAX_RUN_SPEED_MS;
}

function logEffort(log: EngineRunLog): RunEffort | null {
  if (!RUN_FOCUS.test(log.focus ?? "")) return null;
  const meters = log.distanceMeters ?? 0;
  if (meters <= 0) return null;
  let seconds = 0;
  if (log.avgSpeed && log.avgSpeed > 0) seconds = meters / log.avgSpeed;
  else if (log.duration && log.duration > 0) seconds = log.duration * 60;
  return plausible(meters, seconds) ? { date: log.date, meters, seconds } : null;
}

function setEffort(set: EngineSet, distanceUnit: string): RunEffort | null {
  if (!RUN_SET_EXERCISES.has(set.exerciseName)) return null;
  if (set.distance == null || set.distance <= 0 || set.time == null || set.time <= 0) return null;
  const meters = storedDistanceToMetersStamped(
    set.distance,
    { distanceUnit: set.distanceUnit },
    { distanceUnit },
  );
  const seconds = set.time * 60;
  return plausible(meters, seconds) ? { date: set.date, meters, seconds } : null;
}

/**
 * Every run the athlete logged, once. A device import that stands alone also
 * carries one synthesised set with the same distance and time, so a log with
 * its own distance speaks for itself and only logs without one are read
 * through their sets — otherwise every synced run would count twice.
 */
export function collectRunEfforts(
  logs: readonly EngineRunLog[],
  sets: readonly EngineSet[],
  distanceUnit: string,
): RunEffort[] {
  const efforts: RunEffort[] = [];
  const coveredLogs = new Set<string>();
  const nonTraining = new Set<string>();
  for (const log of logs) {
    if (log.countsAsTraining === false) {
      if (log.id) nonTraining.add(log.id);
      continue;
    }
    const effort = logEffort(log);
    if (!effort) continue;
    efforts.push(effort);
    if (log.id) coveredLogs.add(log.id);
  }
  for (const set of sets) {
    const logId = set.workoutLogId ?? "";
    if (coveredLogs.has(logId) || nonTraining.has(logId)) continue;
    const effort = setEffort(set, distanceUnit);
    if (effort) efforts.push(effort);
  }
  return efforts;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted.at(mid) ?? 0;
  return sorted.length % 2 === 0 ? ((sorted.at(mid - 1) ?? upper) + upper) / 2 : upper;
}

/**
 * Training paces fitted to the athlete's best believable recent effort, or
 * null with fewer than two efforts to go on.
 */
export function buildRunPaceZones(efforts: readonly RunEffort[]): RunPaceZones | null {
  const scored = efforts
    .filter((effort) => effort.meters >= MIN_EFFORT_METERS && effort.seconds >= MIN_EFFORT_SECONDS)
    .map((effort) => ({ effort, vdot: vdotFromEffort(effort.meters, effort.seconds) }))
    .filter(({ vdot }) => vdot >= MIN_VDOT && vdot <= MAX_VDOT);
  if (scored.length < MIN_EFFORTS) return null;

  const typical = median(scored.map(({ vdot }) => vdot));
  const best = scored
    .toSorted((a, b) => b.vdot - a.vdot)
    .find(({ vdot }) => vdot <= typical * MAX_BEST_OVER_MEDIAN);
  if (!best) return null;

  const vdot = best.vdot;
  return {
    vdot: Math.round(vdot * 10) / 10,
    basis: best.effort,
    easy: { fast: paceAtFraction(vdot, EASY_FAST), slow: paceAtFraction(vdot, EASY_SLOW) },
    steady: paceAtFraction(vdot, STEADY),
    threshold: paceAtFraction(vdot, THRESHOLD),
    interval: paceAtFraction(vdot, INTERVAL),
    repetition: paceAtFraction(vdot, REPETITION),
  };
}

/** What the athlete runs now: the last four weeks, or null with under two runs. */
export function buildRunVolumeBaseline(
  efforts: readonly RunEffort[],
  today: string,
): RunVolumeBaseline | null {
  const since = addDaysToISODate(today, -(VOLUME_WINDOW_DAYS - 1));
  const recent = efforts.filter((effort) => effort.date >= since && effort.date <= today);
  if (recent.length < 2) return null;
  const weeks = VOLUME_WINDOW_DAYS / 7;
  const totalKm = recent.reduce((sum, effort) => sum + effort.meters, 0) / 1000;
  return {
    weeklyKm: Math.round((totalKm / weeks) * 10) / 10,
    longestRunKm: Math.round((Math.max(...recent.map((effort) => effort.meters)) / 1000) * 10) / 10,
    runsPerWeek: Math.round((recent.length / weeks) * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Volume progression
// ---------------------------------------------------------------------------

/** Starting volume (km/week) for an athlete with no recent runs to read. */
const DEFAULT_START_KM: Readonly<Partial<Record<GoalLens, Record<ExperienceLevel, number>>>> = {
  running: { beginner: 12, intermediate: 25, advanced: 40 },
  hyrox: { beginner: 10, intermediate: 20, advanced: 30 },
  hybrid: { beginner: 10, intermediate: 18, advanced: 28 },
};
/** Where the volume stops climbing, however long the plan. */
const PEAK_KM: Readonly<Partial<Record<GoalLens, Record<ExperienceLevel, number>>>> = {
  running: { beginner: 35, intermediate: 55, advanced: 80 },
  hyrox: { beginner: 25, intermediate: 35, advanced: 50 },
  hybrid: { beginner: 22, intermediate: 32, advanced: 45 },
};
/** The ten-percent rule, with a margin: weekly volume grows at most this much. */
const WEEKLY_VOLUME_GROWTH = 0.08;
/** Over a whole plan, volume at most this multiple of where it started. */
const MAX_VOLUME_MULTIPLE = 1.6;
const MIN_WEEKLY_KM = 5;
const DELOAD_VOLUME = 0.75;
const TAPER_VOLUME = 0.7;
const FINAL_WEEK_VOLUME = 0.5;
const LONG_RUN_SHARE = 0.33;
const MAX_LONG_RUN_SHARE = 0.5;
/** Never open a plan more than this far above what the athlete runs now. */
const MAX_START_OVER_BASELINE = 1.3;

/** The longest long run each goal needs; a marathon plan needs its 30 km runs. */
function longRunCapKm(lens: GoalLens, goal: string): number {
  if (lens === "hyrox") return 14;
  if (lens === "hybrid") return 16;
  if (/half[\s-]?marathon|\b21(?:\.1)?\s?k\b/i.test(goal)) return 21;
  if (/marathon|\b42(?:\.2)?\s?k\b/i.test(goal)) return 32;
  if (/\b10\s?k\b|10,?000\s?m/i.test(goal)) return 16;
  if (/\b5\s?k\b|5,?000\s?m|parkrun/i.test(goal)) return 12;
  return 20;
}

function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

export interface RunVolumeInput {
  readonly lens: GoalLens;
  readonly experience: ExperienceLevel;
  readonly goal?: string | null;
  readonly outline: readonly PlanWeekOutline[];
  readonly baseline: RunVolumeBaseline | null;
  readonly hasRace: boolean;
}

type VolumeWeekKind = "grow" | "hold" | "deload" | "taper" | "final";

/** How far an unloading week's volume drops; loading weeks run the full level. */
const VOLUME_FRACTION: ReadonlyMap<VolumeWeekKind, number> = new Map([
  ["deload", DELOAD_VOLUME],
  ["taper", TAPER_VOLUME],
  ["final", FINAL_WEEK_VOLUME],
]);

/** How far the long run shrinks from the last loading week's, by week kind. */
const LONG_RUN_FRACTION: ReadonlyMap<VolumeWeekKind, number> = new Map([
  ["deload", DELOAD_VOLUME],
  ["taper", 0.6],
  ["final", 0.4],
]);

function volumeWeekKind(entry: PlanWeekOutline, isFinal: boolean): VolumeWeekKind {
  if (entry.deload) return "deload";
  if (isFinal || entry.phase === "race_week") return "final";
  if (entry.phase === "taper") return "taper";
  return entry.phase === "peak" ? "hold" : "grow";
}

/**
 * Where the plan's running opens: toward the goal's usual starting volume, but
 * never more than 30% above what the athlete runs now — and never below it,
 * since a "build" that cuts their running is not one.
 */
function startingVolume(baseline: RunVolumeBaseline | null, goalDefault: number): number {
  if (!baseline) return Math.max(MIN_WEEKLY_KM, goalDefault);
  return Math.max(
    MIN_WEEKLY_KM,
    baseline.weeklyKm,
    Math.min(goalDefault, baseline.weeklyKm * MAX_START_OVER_BASELINE),
  );
}

interface LongRunLimits {
  readonly cap: number;
  /** Don't shrink a loading week's long run far below one the athlete already runs. */
  readonly floor: number;
}

function longRunFor(
  kind: VolumeWeekKind,
  weekly: number,
  lastLoadingLong: number,
  limits: LongRunLimits,
): number {
  // At most half the week — unless the athlete already runs longer than that,
  // in which case the run they already do is not the thing to cut.
  const ceiling = Math.min(limits.cap, Math.max(weekly * MAX_LONG_RUN_SHARE, limits.floor));
  if (kind === "grow" || kind === "hold") {
    // The long run builds with the week (by the same 8% at most) toward the
    // goal's cap; a peak week holds it.
    const grown = kind === "grow" ? lastLoadingLong * (1 + WEEKLY_VOLUME_GROWTH) : lastLoadingLong;
    return Math.min(ceiling, Math.max(weekly * LONG_RUN_SHARE, limits.floor, grown));
  }
  const reference = lastLoadingLong > 0 ? lastLoadingLong : weekly * LONG_RUN_SHARE;
  return Math.min(ceiling, reference * (LONG_RUN_FRACTION.get(kind) ?? 1));
}

/**
 * Weekly volume and long run for every week, or [] for a goal whose plan has
 * no running backbone (strength, body composition, general).
 *
 * Builds from the athlete's own current volume — a plan that opens at double
 * what they run now is how running injuries start — by at most 8% a loading
 * week, holds it through the peak while intensity rises, steps back to 75% in
 * a deload, and unloads through the taper. The long run starts at a third of
 * the week (or near the longest run they already do) and builds with it — at
 * most half the week, capped by what the goal needs.
 */
export function buildRunVolumeTargets(input: RunVolumeInput): RunWeekTarget[] {
  const defaults = DEFAULT_START_KM[input.lens];
  const peaks = PEAK_KM[input.lens];
  if (!defaults || !peaks) return [];

  const start = startingVolume(input.baseline, defaults[input.experience]);
  const ceiling = Math.max(start, Math.min(peaks[input.experience], start * MAX_VOLUME_MULTIPLE));
  const cap = longRunCapKm(input.lens, input.goal ?? "");
  const limits: LongRunLimits = {
    cap,
    floor: Math.min(cap, (input.baseline?.longestRunKm ?? 0) * 0.9),
  };

  let level = start;
  let loadingWeeks = 0;
  let lastLoadingLong = 0;
  const targets: RunWeekTarget[] = [];
  for (const entry of input.outline) {
    const isFinal = entry.week === input.outline.length;
    const kind = volumeWeekKind(entry, isFinal);
    if (kind === "grow") {
      // The first loading week runs at the starting volume; each one after it
      // adds up to 8%. Peak weeks hold the volume and let intensity rise.
      if (loadingWeeks > 0) level = Math.min(ceiling, level * (1 + WEEKLY_VOLUME_GROWTH));
      loadingWeeks += 1;
    }
    const weekly = level * (VOLUME_FRACTION.get(kind) ?? 1);
    const long = longRunFor(kind, weekly, lastLoadingLong, limits);
    if (kind === "grow" || kind === "hold") lastLoadingLong = long;
    targets.push({
      week: entry.week,
      phase: entry.phase,
      deload: entry.deload,
      weeklyKm: roundHalf(weekly),
      // A race week's "long run" is the race itself.
      longRunKm: input.hasRace && isFinal ? 0 : roundHalf(long),
    });
  }
  return targets;
}

// Load by body system.
//
// UTSS answers "how much training?" with one number, and one number cannot say
// where the load landed. A week of sleds, lunges and wall balls can leave UTSS
// and the aerobic picture flat while the legs take their heaviest week in six;
// a swap from running to the SkiErg can hold total load steady while impact
// falls and pulling climbs. This model keeps the four apart.
//
// 1. Every session gets one load on a common base: session RPE × minutes
//    (Foster's session-RPE, arbitrary units). The RPE is the athlete's own when
//    they gave one; otherwise the heart-rate equivalent the load model already
//    uses; otherwise an estimate from what was logged. Such sessions are
//    counted as estimated so the card can say how much of the picture is a
//    guess.
// 2. The load is split across aerobic, running impact, leg muscle and
//    upper-body pull by what the session contained: each exercise's profile
//    (bodySystemProfiles.ts), weighted by its share of the session's time.
// 3. Each system is tracked in rolling 7-day blocks and compared only with its
//    own history: this week against the usual week (the mean of the four full
//    weeks before it), and against the heaviest of the previous five for a
//    six-week high.
//
// A PARALLEL view. Nothing here feeds UTSS, the ACWR governor or any threshold
// calibrated against them, and nothing reads the UTSS scale: the sRPE base is
// the whole point, since it is the one scale every session shares.

import { BODY_SYSTEMS } from "@shared/bodySystemLoad";
import { addDaysToISODate as addDays } from "@shared/dateUtils";
import {
  estimatePlannedSession,
  estimateSetMinutes,
  type PlannedSessionSet,
} from "@shared/plannedSessionEstimate";
import type {
  BodySystem,
  BodySystemLoadOverview,
  BodySystemLoadStatus,
  BodySystemLoadSummary,
  BodySystemWeek,
  WorkoutLog,
} from "@shared/schema";
import { storedDistanceToMetersStamped } from "@shared/unitConversion";

import {
  type BodySystemProfile,
  bodySystemProfileForSet,
  catalogueBodySystemProfile,
  inferExerciseFromTitle,
} from "./bodySystemProfiles";
import { suggestRpeFromHeartRate } from "./heartRateRpe";
import type { AthleteLoadContext, TrainingLoadSet } from "./types";
import { round } from "./utils";

export type BodySystemLog = Pick<
  WorkoutLog,
  | "id"
  | "date"
  | "duration"
  | "rpe"
  | "avgHeartrate"
  | "focus"
  | "mainWorkout"
  | "source"
  | "deviceActivity"
>;

export type BodySystemSet = Pick<
  TrainingLoadSet,
  | "workoutLogId"
  | "exerciseName"
  | "customLabel"
  | "category"
  | "reps"
  | "distance"
  | "time"
  | "plannedReps"
  | "plannedDistance"
  | "plannedTime"
  | "distanceUnit"
>;

export interface BodySystemLoadOptions {
  /** The athlete's today; the newest block ends on it. */
  currentDate: string;
  /** The athlete's distance preference, for legacy set rows with no unit stamp. */
  distanceUnit?: string;
  /** Heart-rate profile, for the effort of a session the athlete did not rate. */
  athlete?: AthleteLoadContext;
}

const WEEK_DAYS = 7;
/** The newest block plus the five before it: what "a six-week high" is measured over. */
const WEEKS_SHOWN = 6;
/** The usual week is the mean of up to this many full blocks before the newest... */
const BASELINE_WEEKS = 4;
/** ...and does not exist until at least this many are available. */
const MIN_BASELINE_WEEKS = 2;

/**
 * Weekly load below which a system is not compared: about 15 minutes at a
 * moderate RPE 5. A ratio over a few sets of face pulls swings wildly and means
 * nothing, and a "new" load has to be at least this big to count as one.
 */
const MIN_MEANINGFUL_WEEK = 75;

/**
 * How far above the usual week the newest block must also be to count as a
 * six-week high. Without it, six near-identical weeks flag whenever the newest
 * happens to be a few units heavier — true, and useless. At 1.2 a steady
 * 5%-a-week build (the newest block ~13% over the four before it) is not
 * flagged every week, and neither is the small aerobic share two extra lifting
 * sessions add; a genuine jump is.
 */
const SIX_WEEK_HIGH_MIN_RATIO = 1.2;

// The session-RPE ACWR bands (Gabbett 2016). The same numbers the UTSS
// governor's resolveAcwrZone reads, and these were first derived on sRPE loads.
// The ratio here is the UNCOUPLED form — this week against the four weeks
// before it, not against a window that contains it.
const LOW_RATIO = 0.8;
const HIGH_RATIO = 1.3;
const VERY_HIGH_RATIO = 1.5;

/** Effort assumed for a session with no rating, no usable heart rate and nothing recognisable logged. */
const FALLBACK_RPE = 5;

/**
 * Distances handed to the shared estimator are converted to metres first, from
 * each row's own unit stamp, so the estimator is told the metric preference.
 */
const METRIC_PREFERENCE = "km";

type SystemLoads = Record<BodySystem, number>;

function emptyLoads(): SystemLoads {
  return { aerobic: 0, running_impact: 0, leg_muscle: 0, upper_pull: 0 };
}

// The load arithmetic names every system rather than indexing by a runtime
// key, so the four fields stay visibly in step.
function scaled(loads: Readonly<SystemLoads>, factor: number): SystemLoads {
  return {
    aerobic: loads.aerobic * factor,
    running_impact: loads.running_impact * factor,
    leg_muscle: loads.leg_muscle * factor,
    upper_pull: loads.upper_pull * factor,
  };
}

function summed(a: Readonly<SystemLoads>, b: Readonly<SystemLoads>): SystemLoads {
  return {
    aerobic: a.aerobic + b.aerobic,
    running_impact: a.running_impact + b.running_impact,
    leg_muscle: a.leg_muscle + b.leg_muscle,
    upper_pull: a.upper_pull + b.upper_pull,
  };
}

function loadFor(loads: Readonly<SystemLoads>, system: BodySystem): number {
  switch (system) {
    case "aerobic":
      return loads.aerobic;
    case "running_impact":
      return loads.running_impact;
    case "leg_muscle":
      return loads.leg_muscle;
    case "upper_pull":
      return loads.upper_pull;
  }
}

interface SessionComponent {
  profile: BodySystemProfile | null;
  minutes: number;
}

interface ScoredSession {
  /** Null when the session has no duration and no sets: nothing to score. */
  loads: SystemLoads | null;
  estimated: boolean;
  attributed: boolean;
}

/** A logged set in the shape the shared session estimator reads. */
function toEstimateSet(set: BodySystemSet, distanceUnit: string | undefined): PlannedSessionSet {
  const rawDistance = set.distance ?? set.plannedDistance;
  return {
    // A custom set's label is the better guess at its pace and effort.
    exerciseName:
      set.exerciseName === "custom" && set.customLabel ? set.customLabel : set.exerciseName,
    // Actuals win: this is what was done, not what was prescribed.
    time: set.time ?? set.plannedTime,
    reps: set.reps ?? set.plannedReps,
    distance:
      rawDistance == null
        ? null
        : storedDistanceToMetersStamped(rawDistance, set, { distanceUnit }),
  };
}

/**
 * The session's effort on the CR-10 scale, and whether it was estimated.
 *
 * The athlete's rating when there is one. Otherwise the heart-rate equivalent
 * (the same value the review sheet offers, withheld for lifting, where average
 * heart rate under-reads). Otherwise the default effort of the hardest thing
 * logged, from the same table the planned-session estimate uses.
 */
function resolveEffort(
  log: BodySystemLog,
  estimateSets: readonly PlannedSessionSet[],
  athlete: AthleteLoadContext | undefined,
): { rpe: number; estimated: boolean } {
  if (log.rpe != null && log.rpe >= 1 && log.rpe <= 10) return { rpe: log.rpe, estimated: false };
  const fromHeartRate = suggestRpeFromHeartRate(log, athlete);
  if (fromHeartRate != null) return { rpe: fromHeartRate, estimated: true };
  const fromContent = estimatePlannedSession({
    exerciseSets: estimateSets,
    distanceUnit: METRIC_PREFERENCE,
  }).rpe;
  return { rpe: fromContent ?? FALLBACK_RPE, estimated: true };
}

/**
 * The session's minutes, and whether they were estimated.
 *
 * Logged duration when there is one; otherwise an estimate from the LOGGED
 * sets only. A set-less session whose title says "Easy run" is not given an
 * invented duration: it has none to score.
 */
function resolveDuration(
  log: BodySystemLog,
  loggedSets: readonly PlannedSessionSet[],
): { minutes: number; estimated: boolean } | null {
  if (log.duration != null && log.duration > 0) return { minutes: log.duration, estimated: false };
  if (loggedSets.length === 0) return null;
  const minutes = estimatePlannedSession({
    exerciseSets: loggedSets,
    distanceUnit: METRIC_PREFERENCE,
  }).durationMin;
  return minutes == null ? null : { minutes, estimated: true };
}

/**
 * Each system's share of the session: every component's profile weighted by
 * its share of the session's time. A component with no profile keeps its
 * time share, so the part of a session nothing is known about stays
 * unattributed instead of being spread over the parts that are.
 */
function sessionMix(components: readonly SessionComponent[]): SystemLoads {
  let mix = emptyLoads();
  let totalMinutes = 0;
  for (const component of components) totalMinutes += component.minutes;
  if (totalMinutes <= 0) return mix;
  for (const { profile, minutes } of components) {
    if (profile) mix = summed(mix, scaled(profile, minutes / totalMinutes));
  }
  return mix;
}

function scoreSession(
  log: BodySystemLog,
  sets: readonly BodySystemSet[],
  options: BodySystemLoadOptions,
): ScoredSession {
  const logged = sets.map((set) => ({ set, estimate: toEstimateSet(set, options.distanceUnit) }));
  const loggedSets = logged.map(({ estimate }) => estimate);
  const duration = resolveDuration(log, loggedSets);
  if (!duration) return { loads: null, estimated: false, attributed: false };

  let components: SessionComponent[];
  let effortSets: readonly PlannedSessionSet[] = loggedSets;
  if (logged.length > 0) {
    components = logged.map(({ set, estimate }) => ({
      profile: bodySystemProfileForSet(set),
      minutes: estimateSetMinutes(estimate, METRIC_PREFERENCE),
    }));
  } else {
    // No sets (a free-text log, or an import without one): the title is all
    // there is to go on.
    const inferred = inferExerciseFromTitle(log);
    components = inferred ? [{ profile: catalogueBodySystemProfile(inferred), minutes: 1 }] : [];
    effortSets = inferred ? [{ exerciseName: inferred }] : [];
  }

  const effort = resolveEffort(log, effortSets, options.athlete);
  const mix = sessionMix(components);
  return {
    loads: scaled(mix, effort.rpe * duration.minutes),
    estimated: effort.estimated || duration.estimated,
    attributed: Object.values(mix).some((share) => share > 0),
  };
}

/** The six rolling 7-day blocks, oldest first, the newest ending on `currentDate`. */
function buildWeeks(currentDate: string): BodySystemWeek[] {
  const weeks: BodySystemWeek[] = [];
  for (let back = WEEKS_SHOWN - 1; back >= 0; back--) {
    const end = addDays(currentDate, -WEEK_DAYS * back);
    weeks.push({ start: addDays(end, -(WEEK_DAYS - 1)), end });
  }
  return weeks;
}

/** Every system's load summed over one block. */
function weekLoads(daily: ReadonlyMap<string, SystemLoads>, week: BodySystemWeek): SystemLoads {
  let total = emptyLoads();
  for (let date = week.start; date <= week.end; date = addDays(date, 1)) {
    const day = daily.get(date);
    if (day) total = summed(total, day);
  }
  return total;
}

function mean(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function ratioStatus(ratio: number): BodySystemLoadStatus {
  if (ratio < LOW_RATIO) return "low";
  if (ratio <= HIGH_RATIO) return "normal";
  if (ratio <= VERY_HIGH_RATIO) return "high";
  return "very_high";
}

/**
 * Status and ratio against the usual week. A usual week too small to divide
 * by has no ratio: the system is either still minimal, or has taken on a real
 * week of load from almost nothing, which is its own finding.
 */
function classify(
  current: number,
  baseline: number | null,
): { status: BodySystemLoadStatus; ratio: number | null } {
  if (baseline == null) return { status: "insufficient_data", ratio: null };
  if (baseline < MIN_MEANINGFUL_WEEK) {
    return { status: current < MIN_MEANINGFUL_WEEK ? "minimal" : "new", ratio: null };
  }
  const ratio = round(current / baseline, 2);
  return { status: ratioStatus(ratio), ratio };
}

/**
 * One system's summary. A block counts toward the usual week and the six-week
 * comparison only when it lies wholly inside the athlete's history (it starts
 * on or after their first logged session): a block the first session falls
 * inside is a real but partial week, and comparing against it would call
 * every new athlete's second week a spike.
 *
 * Every comparison runs on the rounded totals, so the flags always agree with
 * the numbers on screen.
 */
function summarise(
  system: BodySystem,
  weeks: readonly BodySystemWeek[],
  loadsByWeek: readonly SystemLoads[],
  firstLogDate: string | null,
): BodySystemLoadSummary {
  const totals = loadsByWeek.map((loads) => Math.round(loadFor(loads, system)));
  const newest = weeks.length - 1;
  const current = totals.at(newest) ?? 0;
  const isFull = (index: number): boolean => {
    // Guarded because .at() wraps a negative index round to the newest block.
    const week = index >= 0 ? weeks.at(index) : undefined;
    return firstLogDate != null && week != null && week.start >= firstLogDate;
  };

  const baselineWeeks: number[] = [];
  for (let back = 1; back <= BASELINE_WEEKS; back++) {
    if (isFull(newest - back)) baselineWeeks.push(totals.at(newest - back) ?? 0);
  }
  const baseline =
    baselineWeeks.length >= MIN_BASELINE_WEEKS ? Math.round(mean(baselineWeeks)) : null;
  const { status, ratio } = classify(current, baseline);

  const previous = totals.slice(0, newest);
  const previousPeak = previous.every((_, index) => isFull(index)) ? Math.max(...previous) : null;
  const sixWeekHigh =
    previousPeak != null &&
    ratio != null &&
    ratio >= SIX_WEEK_HIGH_MIN_RATIO &&
    current > previousPeak;

  return {
    system,
    current,
    baseline,
    ratio,
    status,
    sixWeekHigh,
    previousPeak,
    weekly: weeks.map((week, index) =>
      firstLogDate == null || week.end < firstLogDate ? null : (totals.at(index) ?? 0),
    ),
  };
}

function groupSetsByLog(sets: readonly BodySystemSet[]): Map<string, BodySystemSet[]> {
  const byLog = new Map<string, BodySystemSet[]>();
  for (const set of sets) {
    const existing = byLog.get(set.workoutLogId);
    if (existing) existing.push(set);
    else byLog.set(set.workoutLogId, [set]);
  }
  return byLog;
}

/**
 * Load by body system for the six weeks ending on `options.currentDate`.
 *
 * Pass at least 42 days of logs; more is harmless. History starts at the
 * earliest log passed (as the UTSS model's seed does), so a window fetched
 * shorter than the athlete's real history reads as a newer athlete — cautious,
 * never a false spike.
 */
export function calculateBodySystemLoad(
  workoutLogs: readonly BodySystemLog[],
  exerciseSets: readonly BodySystemSet[],
  options: BodySystemLoadOptions,
): BodySystemLoadOverview {
  const { currentDate } = options;
  const weeks = buildWeeks(currentDate);
  const windowStart = weeks[0]?.start ?? currentDate;
  const setsByLog = groupSetsByLog(exerciseSets);
  const daily = new Map<string, SystemLoads>();
  let firstLogDate: string | null = null;
  let sessionCount = 0;
  let estimatedSessions = 0;
  let unattributedSessions = 0;
  let unscoredSessions = 0;

  for (const log of workoutLogs) {
    if (log.date > currentDate) continue;
    if (firstLogDate == null || log.date < firstLogDate) firstLogDate = log.date;
    if (log.date < windowStart) continue;

    sessionCount++;
    const session = scoreSession(log, setsByLog.get(log.id) ?? [], options);
    if (!session.loads) {
      unscoredSessions++;
      continue;
    }
    if (session.estimated) estimatedSessions++;
    if (!session.attributed) {
      unattributedSessions++;
      continue;
    }
    daily.set(log.date, summed(daily.get(log.date) ?? emptyLoads(), session.loads));
  }

  const loadsByWeek = weeks.map((week) => weekLoads(daily, week));
  return {
    asOf: currentDate,
    weeks,
    systems: BODY_SYSTEMS.map((system) => summarise(system, weeks, loadsByWeek, firstLogDate)),
    sessionCount,
    estimatedSessions,
    unattributedSessions,
    unscoredSessions,
  };
}

import { dayDiff } from "@shared/dateUtils";
import { type ExerciseSet, exerciseTracksDistance } from "@shared/schema";
import {
  buildStationCoverage,
  type StationCoverageSource,
  stationsRuledOutByConstraints,
} from "@shared/stationCoverage";
import {
  formatDistance,
  formatPace,
  metersToUserDistance,
  paceSecondsPerUnit,
  storedDistanceToMetersStamped,
} from "@shared/unitConversion";
import { formatMinutes, minutes, minutesToSeconds, unitless } from "@shared/units";

import type { TrainingContext } from "../../gemini/index";
import { addDaysLocal, getLocalDateStrSafe } from "../../timezone";
import { toDateStr } from "../../types";
import { getMondayWeekBoundaries } from "../weeklyProgress";
import type { TimelineEntry } from "./types";

export function computeRpeTrend(recentWorkouts: TrainingContext["recentWorkouts"]): Pick<
  NonNullable<TrainingContext["coachingInsights"]>,
  "rpeTrend" | "avgRpeLast3" | "avgRpePrior3" | "fatigueFlag" | "undertrainingFlag"
> {
  const withRpe = recentWorkouts.filter((w): w is typeof w & { rpe: number } => w.rpe != null && w.rpe > 0);
  if (withRpe.length < 3) {
    return { rpeTrend: "insufficient_data", fatigueFlag: false, undertrainingFlag: false };
  }

  const last3 = withRpe.slice(0, 3);
  const prior3 = withRpe.slice(3, 6);
  const avgLast3 = Math.round((last3.reduce((s, w) => s + (w.rpe ?? 0), 0) / last3.length) * 10) / 10;

  if (prior3.length < 2) {
    return {
      rpeTrend: "insufficient_data",
      avgRpeLast3: avgLast3,
      fatigueFlag: avgLast3 >= 8,
      undertrainingFlag: avgLast3 <= 4,
    };
  }

  const avgPrior3 = Math.round((prior3.reduce((s, w) => s + (w.rpe ?? 0), 0) / prior3.length) * 10) / 10;
  const diff = avgLast3 - avgPrior3;

  let rpeTrend: "rising" | "stable" | "falling";
  if (diff > 0.8) rpeTrend = "rising";
  else if (diff < -0.8) rpeTrend = "falling";
  else rpeTrend = "stable";

  // Additive/hybrid flags: an absolute backstop (sustained hard/easy load) OR a
  // trend into a meaningfully hard/easy zone. This makes the booleans match what
  // the coaching prompt claims ("fatigueFlag / RPE rising"): a sharp rise into
  // RPE 7+ flags fatigue below the absolute 8, and a fall into RPE 5- flags
  // undertraining above the absolute 4, while a stable, intentional RPE 8 block
  // still flags via the backstop. The 7/5 trend bounds are tunable.
  const fatigueFlag = avgLast3 >= 8 || (rpeTrend === "rising" && avgLast3 >= 7);
  const undertrainingFlag = avgLast3 <= 4 || (rpeTrend === "falling" && avgLast3 <= 5);

  return { rpeTrend, avgRpeLast3: avgLast3, avgRpePrior3: avgPrior3, fatigueFlag, undertrainingFlag };
}

/**
 * Days since each HYROX station was last trained, for the coaching prompt.
 *
 * A thin adapter over the shared coverage builder — the station list, the
 * exercise matching and the focus-text keywords all used to be duplicated here,
 * and had drifted from the copy behind the analytics payload badly enough that
 * the two reported different gaps for the same station. The shape and the
 * exported name are unchanged; every downstream consumer is untouched.
 *
 * Stations the athlete's standing constraints rule out are dropped entirely.
 * The gap computation has no equipment model, so without this it renders
 * "sled_push (NEVER TRAINED — CRITICAL)" into the same prompt whose
 * constraints block says "no sled at my gym" — a contradiction the model has
 * to resolve on every single turn (coach-memory-spec §5.1). The suppression is
 * coach-side only: the analytics coverage card keeps showing every station,
 * because the athlete's own view of their history is data, not a nag.
 */
export function computeExerciseGaps(
  timeline: TimelineEntry[],
  trainingConstraints?: string | null,
): NonNullable<TrainingContext["coachingInsights"]>["stationGaps"] {
  const sources: StationCoverageSource[] = [];

  for (const entry of timeline) {
    if (entry.status !== "completed" || !entry.date) continue;
    sources.push({
      date: entry.date,
      exerciseNames: (entry.exerciseSets ?? []).map(es => es.exerciseName),
      freeText: entry.focus ? [entry.focus] : [],
    });
  }

  const ruledOut = new Set(stationsRuledOutByConstraints(trainingConstraints));
  return buildStationCoverage(sources, toDateStr())
    .filter(({ station }) => !ruledOut.has(station))
    .map(({ station, daysSince }) => ({
      station,
      daysSinceLastTrained: daysSince,
    }));
}

export function computeWeeklyVolume(
  timeline: TimelineEntry[],
  weeklyGoal: number,
  userTimezone?: string | null,
): NonNullable<TrainingContext["coachingInsights"]>["weeklyVolume"] {
  const { thisMondayStr, lastMondayStr } = getMondayWeekBoundaries(new Date(), userTimezone);
  const todayStr = getLocalDateStrSafe(new Date(), userTimezone ?? undefined);

  // The trend compares like with like. It used to weigh a PARTIAL current week
  // against a COMPLETE previous one, so on Monday morning the coach was told
  // volume was "decreasing" no matter how the athlete was actually training
  // (audit H11). Last week is now counted only as far through the week as today
  // is — Wednesday's three sessions against last Wednesday's, not against last
  // week's full seven days.
  const lastWeekCutoff = addDaysLocal(lastMondayStr, dayDiff(thisMondayStr, todayStr));

  let thisWeek = 0;
  let lastWeekToDate = 0;
  let lastWeekTotal = 0;
  for (const entry of timeline) {
    if (entry.status !== "completed" || !entry.date) continue;
    if (entry.date >= thisMondayStr) {
      thisWeek++;
    } else if (entry.date >= lastMondayStr && entry.date < thisMondayStr) {
      lastWeekTotal++;
      if (entry.date <= lastWeekCutoff) lastWeekToDate++;
    }
  }

  let trend: "increasing" | "stable" | "decreasing";
  if (thisWeek > lastWeekToDate) trend = "increasing";
  else if (thisWeek < lastWeekToDate) trend = "decreasing";
  else trend = "stable";

  // `lastWeekCompleted` stays last week's FULL total, which is what the coach
  // should quote; only the trend uses the like-for-like slice.
  return { thisWeekCompleted: thisWeek, lastWeekCompleted: lastWeekTotal, goal: weeklyGoal, trend };
}

type ProgressionFlag = NonNullable<TrainingContext["coachingInsights"]>["progressionFlags"][0];

function compareEntryDates(a: TimelineEntry, b: TimelineEntry): number {
  const dateA = a.date ?? "";
  const dateB = b.date ?? "";
  if (dateA < dateB) return -1;
  if (dateA > dateB) return 1;
  return 0;
}

/**
 * One session's comparable efforts for a single exercise.
 *
 * `bestSpeedMps` and `bestTime` are deliberately exclusive buckets. A set that
 * records a distance is summarised as a SPEED (fastest set wins); a set with no
 * distance is summarised as a raw duration. Mixing the two is what made the
 * coach announce that a treadmill run had "worsened from 16 min to 53 min" —
 * three different run lengths read as three attempts at the same effort.
 */
interface SessionEffort {
  date: string;
  maxWeight?: number;
  /** Fastest distance-carrying set, m/s. Compared as pace via paceSecondsPerUnit. */
  bestSpeedMps?: number;
  /** Distance of that fastest set, in metres — quoted so the coach sees the effort's size. */
  bestSpeedDistanceM?: number;
  /** Shortest set that recorded a time but NO distance. */
  bestTime?: number;
  /** Reps on that set. Raw duration only compares like-for-like work (see analyzeTimeProgression). */
  repsAtBestTime?: number | null;
}

function setDistanceInMetres(es: ExerciseSet, distanceUnit: string): number {
  if (es.distance == null || es.distance <= 0) return 0;
  return storedDistanceToMetersStamped(es.distance, { distanceUnit: es.distanceUnit }, { distanceUnit });
}

function aggregateExercisePeaks(
  exerciseSets: NonNullable<TimelineEntry["exerciseSets"]>,
  distanceUnit: string,
): Record<string, Omit<SessionEffort, "date">> {
  const perExercise: Record<string, Omit<SessionEffort, "date">> = {};
  for (const es of exerciseSets) {
    if (!perExercise[es.exerciseName]) perExercise[es.exerciseName] = {};
    const pe = perExercise[es.exerciseName];
    if (es.weight && (!pe.maxWeight || es.weight > pe.maxWeight)) pe.maxWeight = es.weight;
    if (!es.time || es.time <= 0) continue;

    const metres = setDistanceInMetres(es, distanceUnit);
    if (metres > 0) {
      const speedMps = metres / unitless(minutesToSeconds(minutes(es.time)));
      if (pe.bestSpeedMps == null || speedMps > pe.bestSpeedMps) {
        pe.bestSpeedMps = speedMps;
        pe.bestSpeedDistanceM = metres;
      }
    } else if (pe.bestTime == null || es.time < pe.bestTime) {
      pe.bestTime = es.time;
      pe.repsAtBestTime = es.reps ?? null;
    }
  }
  return perExercise;
}

function collectExerciseHistory(
  timeline: TimelineEntry[],
  distanceUnit: string,
): Record<string, SessionEffort[]> {
  const history: Record<string, SessionEffort[]> = {};

  const completed = timeline
    .filter(e => e.status === "completed" && e.date && e.exerciseSets && e.exerciseSets.length > 0)
    .sort(compareEntryDates);

  for (const entry of completed) {
    const peaks = aggregateExercisePeaks(entry.exerciseSets ?? [], distanceUnit);
    for (const [name, stats] of Object.entries(peaks)) {
      if (!history[name]) history[name] = [];
      history[name].push({ date: entry.date ?? "", ...stats });
    }
  }

  return history;
}

/**
 * `weightUnit` is required, not defaulted.
 *
 * `exercise_sets.weight` is stored in the athlete's OWN unit (the S5 sentinel in
 * unitConversion.ts), so these details used to interpolate a hardcoded "kg" over
 * a pounds athlete's numbers and hand the coaching model loads inflated 2.2x
 * (audit M8). `buildPersonalRecordSummaries` in ai/index.ts already threads the
 * real unit through for the same reason; this follows it.
 */
function analyzeWeightProgression(exercise: string, recent3: SessionEffort[], weightUnit: string): ProgressionFlag | null {
  const values = recent3.map(s => s.maxWeight);
  if (!isTriple(values)) return null;
  const [first, , last] = values;
  if (values.every(w => w === first)) {
    return { exercise, flag: "plateau", detail: `Weight stuck at ${first}${weightUnit} for last 3 sessions` };
  }
  if (last > first) {
    return { exercise, flag: "progressing", detail: `Weight increased from ${first}${weightUnit} to ${last}${weightUnit} over last 3 sessions` };
  }
  if (last < first) {
    return { exercise, flag: "regressing", detail: `Weight decreased from ${first}${weightUnit} to ${last}${weightUnit} over last 3 sessions` };
  }
  return null;
}

/** Pace moves this little between sessions and nothing has changed. 3 s per km/mile. */
const PACE_TOLERANCE_SECONDS = 3;

/**
 * The comparison for anything measured over ground: runs, ergs, carries, sleds.
 *
 * Duration alone says only how long the athlete was out; PACE says how fast they
 * covered the distance, which is the thing that can actually progress or regress.
 * The distance behind each pace is quoted alongside it so the coaching model can
 * see when it is comparing a 5 km effort with a 12 km one and temper the claim,
 * rather than reading two paces as a clean head-to-head.
 */
function analyzePaceProgression(exercise: string, recent3: SessionEffort[], distanceUnit: string): ProgressionFlag | null {
  const speeds = recent3.map(s => s.bestSpeedMps);
  if (!isTriple(speeds)) return null;

  const paces = speeds.map(mps => paceSecondsPerUnit(mps, distanceUnit));
  if (!isTriple(paces)) return null;

  const asText = (i: number) => {
    const distance = recent3[i].bestSpeedDistanceM;
    const size = distance == null ? "" : ` (${formatDistance(metersToUserDistance(distance, distanceUnit), distanceUnit, 1)})`;
    return `${formatPace(speeds[i], distanceUnit)}${size}`;
  };
  const [first, , last] = paces;

  if (paces.every(p => Math.abs(p - first) <= PACE_TOLERANCE_SECONDS)) {
    return { exercise, flag: "plateau", detail: `Pace stuck at ${asText(0)} for last 3 sessions` };
  }
  if (last < first - PACE_TOLERANCE_SECONDS) {
    return { exercise, flag: "progressing", detail: `Pace improved from ${asText(0)} to ${asText(2)} over last 3 sessions` };
  }
  if (last > first + PACE_TOLERANCE_SECONDS) {
    return { exercise, flag: "regressing", detail: `Pace worsened from ${asText(0)} to ${asText(2)} over last 3 sessions` };
  }
  return null;
}

/**
 * Raw duration, for work whose SIZE is stated and whose clock is therefore a
 * result: 50 wall balls in 4 min beats 50 in 5 min.
 *
 * Two guards keep this off efforts where the clock is not a score. Distance-
 * carrying exercises never reach here at all — computeProgressionFlags routes
 * them through pace, or drops them when the distance was not logged — and the
 * work has to be sized by a rep count that is IDENTICAL across the three
 * sessions. 50 wall balls in 4 min says nothing against 30 in 3 min, and an
 * unsized clock is worse still: it may be a hold, where 60s beats 30s and
 * "improved from 60s to 30s" has the sign backwards.
 *
 * `bestTime` is exercise_sets.time, i.e. MINUTES, and may be fractional now that
 * seconds-valued step targets are converted on the way in (audit C7) -- so these
 * render through formatMinutes rather than pasting a "min" suffix on a raw
 * number that could read "0.75min".
 */
function analyzeTimeProgression(exercise: string, recent3: SessionEffort[]): ProgressionFlag | null {
  const values = recent3.map(s => s.bestTime);
  if (!isTriple(values)) return null;

  const reps = recent3.map(s => s.repsAtBestTime);
  if (!isTriple(reps) || new Set(reps).size > 1) return null;

  const [first, , last] = values;
  const asText = (v: number) => formatMinutes(minutes(v));
  if (values.every(t => Math.abs(t - first) < 0.1)) {
    return { exercise, flag: "plateau", detail: `Time stuck at ${asText(first)} for last 3 sessions` };
  }
  if (last < first) {
    return { exercise, flag: "progressing", detail: `Time improved from ${asText(first)} to ${asText(last)} over last 3 sessions` };
  }
  if (last > first) {
    return { exercise, flag: "regressing", detail: `Time worsened from ${asText(first)} to ${asText(last)} over last 3 sessions` };
  }
  return null;
}

/**
 * Every one of the three sessions carries the metric, so "over last 3 sessions"
 * is literally true.
 *
 * The old code flattened each metric into its own array across the whole
 * history and took the last three VALUES, which on a mixed log compared
 * sessions that were neither adjacent nor recent — a weight logged in January
 * and two in June read as "the last 3 sessions".
 */
function isTriple(values: Array<number | null | undefined>): values is [number, number, number] {
  return values.length === 3 && values.every((v): v is number => v != null);
}

export function computeProgressionFlags(
  timeline: TimelineEntry[],
  weightUnit: string,
  distanceUnit: string,
): NonNullable<TrainingContext["coachingInsights"]>["progressionFlags"] {
  const exerciseHistory = collectExerciseHistory(timeline, distanceUnit);
  const flags: ProgressionFlag[] = [];

  for (const [exercise, history] of Object.entries(exerciseHistory)) {
    if (history.length === 1) {
      flags.push({ exercise, flag: "new", detail: `Only trained once (${history[0].date})` });
      continue;
    }

    const recent3 = history.slice(-3);
    if (recent3.length < 3) continue;

    const weightFlag = analyzeWeightProgression(exercise, recent3, weightUnit);
    if (weightFlag) { flags.push(weightFlag); continue; }

    const paceFlag = analyzePaceProgression(exercise, recent3, distanceUnit);
    if (paceFlag) { flags.push(paceFlag); continue; }

    // A distance-carrying exercise logged without its distance yields no
    // comparable effort at all. Saying nothing is the honest answer; the
    // alternative is the run-duration nonsense this guard exists to stop.
    if (exerciseTracksDistance(exercise)) continue;

    const timeFlag = analyzeTimeProgression(exercise, recent3);
    if (timeFlag) flags.push(timeFlag);
  }

  return flags;
}


// Plan-phase math lives in shared/ so the Timeline summary card renders the same
// week and phase the coaching prompts are built from. Re-exported here because
// every server caller already imports it from this module.
export { computeCurrentWeek, computePlanPhase } from "@shared/planPhase";

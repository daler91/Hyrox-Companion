import { buildStationCoverage, type StationCoverageSource } from "@shared/stationCoverage";

import type { TrainingContext } from "../../gemini/index";
import { toDateStr } from "../../types";
import { getMondayWeekBoundaries } from "../weeklyProgress";
import type { TimelineEntry } from "./types";

export function computeRpeTrend(
  recentWorkouts: TrainingContext["recentWorkouts"],
): Pick<
  NonNullable<TrainingContext["coachingInsights"]>,
  "rpeTrend" | "avgRpeLast3" | "avgRpePrior3" | "fatigueFlag" | "undertrainingFlag"
> {
  const withRpe = recentWorkouts.filter(
    (w): w is typeof w & { rpe: number } => w.rpe != null && w.rpe > 0,
  );
  if (withRpe.length < 3) {
    return { rpeTrend: "insufficient_data", fatigueFlag: false, undertrainingFlag: false };
  }

  const last3 = withRpe.slice(0, 3);
  const prior3 = withRpe.slice(3, 6);
  const avgLast3 =
    Math.round((last3.reduce((s, w) => s + (w.rpe ?? 0), 0) / last3.length) * 10) / 10;

  if (prior3.length < 2) {
    return {
      rpeTrend: "insufficient_data",
      avgRpeLast3: avgLast3,
      fatigueFlag: avgLast3 >= 8,
      undertrainingFlag: avgLast3 <= 4,
    };
  }

  const avgPrior3 =
    Math.round((prior3.reduce((s, w) => s + (w.rpe ?? 0), 0) / prior3.length) * 10) / 10;
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

  return {
    rpeTrend,
    avgRpeLast3: avgLast3,
    avgRpePrior3: avgPrior3,
    fatigueFlag,
    undertrainingFlag,
  };
}

/**
 * Days since each HYROX station was last trained, for the coaching prompt.
 *
 * A thin adapter over the shared coverage builder — the station list, the
 * exercise matching and the focus-text keywords all used to be duplicated here,
 * and had drifted from the copy behind the analytics payload badly enough that
 * the two reported different gaps for the same station. The shape and the
 * exported name are unchanged; every downstream consumer is untouched.
 */
export function computeExerciseGaps(
  timeline: TimelineEntry[],
): NonNullable<TrainingContext["coachingInsights"]>["stationGaps"] {
  const sources: StationCoverageSource[] = [];

  for (const entry of timeline) {
    if (entry.status !== "completed" || !entry.date) continue;
    sources.push({
      date: entry.date,
      exerciseNames: (entry.exerciseSets ?? []).map((es) => es.exerciseName),
      freeText: entry.focus ? [entry.focus] : [],
    });
  }

  return buildStationCoverage(sources, toDateStr()).map(({ station, daysSince }) => ({
    station,
    daysSinceLastTrained: daysSince,
  }));
}

export function computeWeeklyVolume(
  timeline: TimelineEntry[],
  weeklyGoal: number,
): NonNullable<TrainingContext["coachingInsights"]>["weeklyVolume"] {
  const { thisMondayStr, lastMondayStr } = getMondayWeekBoundaries();

  let thisWeek = 0;
  let lastWeek = 0;
  for (const entry of timeline) {
    if (entry.status !== "completed" || !entry.date) continue;
    if (entry.date >= thisMondayStr) thisWeek++;
    else if (entry.date >= lastMondayStr && entry.date < thisMondayStr) lastWeek++;
  }

  let trend: "increasing" | "stable" | "decreasing";
  if (thisWeek > lastWeek) trend = "increasing";
  else if (thisWeek < lastWeek) trend = "decreasing";
  else trend = "stable";

  return { thisWeekCompleted: thisWeek, lastWeekCompleted: lastWeek, goal: weeklyGoal, trend };
}

type ProgressionFlag = NonNullable<TrainingContext["coachingInsights"]>["progressionFlags"][0];

function compareEntryDates(a: TimelineEntry, b: TimelineEntry): number {
  const dateA = a.date ?? "";
  const dateB = b.date ?? "";
  if (dateA < dateB) return -1;
  if (dateA > dateB) return 1;
  return 0;
}

function aggregateExercisePeaks(
  exerciseSets: NonNullable<TimelineEntry["exerciseSets"]>,
): Record<string, { maxWeight?: number; bestTime?: number }> {
  const perExercise: Record<string, { maxWeight?: number; bestTime?: number }> = {};
  for (const es of exerciseSets) {
    if (!perExercise[es.exerciseName]) perExercise[es.exerciseName] = {};
    const pe = perExercise[es.exerciseName];
    if (es.weight && (!pe.maxWeight || es.weight > pe.maxWeight)) pe.maxWeight = es.weight;
    if (es.time && (!pe.bestTime || es.time < pe.bestTime)) pe.bestTime = es.time;
  }
  return perExercise;
}

function collectExerciseHistory(
  timeline: TimelineEntry[],
): Record<string, Array<{ date: string; maxWeight?: number; bestTime?: number }>> {
  const history: Record<
    string,
    Array<{ date: string; maxWeight?: number; bestTime?: number }>
  > = {};

  const completed = timeline
    .filter(
      (e) => e.status === "completed" && e.date && e.exerciseSets && e.exerciseSets.length > 0,
    )
    .sort(compareEntryDates);

  for (const entry of completed) {
    const peaks = aggregateExercisePeaks(entry.exerciseSets ?? []);
    for (const [name, stats] of Object.entries(peaks)) {
      if (!history[name]) history[name] = [];
      history[name].push({ date: entry.date ?? "", ...stats });
    }
  }

  return history;
}

function analyzeWeightProgression(exercise: string, values: number[]): ProgressionFlag | null {
  if (values.length < 3) return null;
  const recent3 = values.slice(-3);
  if (recent3.every((w) => w === recent3[0])) {
    return {
      exercise,
      flag: "plateau",
      detail: `Weight stuck at ${recent3[0]}kg for last ${recent3.length} sessions`,
    };
  }
  if (recent3[2] > recent3[0]) {
    return {
      exercise,
      flag: "progressing",
      detail: `Weight increased from ${recent3[0]}kg to ${recent3[2]}kg over last 3 sessions`,
    };
  }
  if (recent3[2] < recent3[0]) {
    return {
      exercise,
      flag: "regressing",
      detail: `Weight decreased from ${recent3[0]}kg to ${recent3[2]}kg over last 3 sessions`,
    };
  }
  return null;
}

function analyzeTimeProgression(exercise: string, values: number[]): ProgressionFlag | null {
  if (values.length < 3) return null;
  const recent3 = values.slice(-3);
  if (recent3.every((t) => Math.abs(t - recent3[0]) < 0.1)) {
    return {
      exercise,
      flag: "plateau",
      detail: `Time stuck at ${recent3[0]}min for last ${recent3.length} sessions`,
    };
  }
  if (recent3[2] < recent3[0]) {
    return {
      exercise,
      flag: "progressing",
      detail: `Time improved from ${recent3[0]}min to ${recent3[2]}min over last 3 sessions`,
    };
  }
  if (recent3[2] > recent3[0]) {
    return {
      exercise,
      flag: "regressing",
      detail: `Time worsened from ${recent3[0]}min to ${recent3[2]}min over last 3 sessions`,
    };
  }
  return null;
}

/** Single-pass extraction of weight and time values from exercise history. */
function extractWeightsAndTimes(history: Array<{ maxWeight?: number; bestTime?: number }>): {
  weights: number[];
  times: number[];
} {
  const weights: number[] = [];
  const times: number[] = [];
  for (const h of history) {
    if (h.maxWeight != null) weights.push(h.maxWeight);
    if (h.bestTime != null) times.push(h.bestTime);
  }
  return { weights, times };
}

export function computeProgressionFlags(
  timeline: TimelineEntry[],
): NonNullable<TrainingContext["coachingInsights"]>["progressionFlags"] {
  const exerciseHistory = collectExerciseHistory(timeline);
  const flags: ProgressionFlag[] = [];

  for (const [exercise, history] of Object.entries(exerciseHistory)) {
    if (history.length === 1) {
      flags.push({ exercise, flag: "new", detail: `Only trained once (${history[0].date})` });
      continue;
    }
    if (history.length < 2) continue;

    const { weights, times } = extractWeightsAndTimes(history);

    const weightFlag = analyzeWeightProgression(exercise, weights);
    if (weightFlag) {
      flags.push(weightFlag);
      continue;
    }

    const timeFlag = analyzeTimeProgression(exercise, times);
    if (timeFlag) flags.push(timeFlag);
  }

  return flags;
}

// Plan-phase math lives in shared/ so the Timeline summary card renders the same
// week and phase the coaching prompts are built from. Re-exported here because
// every server caller already imports it from this module.
export { computeCurrentWeek, computePlanPhase } from "@shared/planPhase";

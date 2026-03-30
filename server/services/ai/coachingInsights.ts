import type { TrainingContext } from "../../gemini/index";
import { toDateStr } from "../../types";
import type { TimelineEntry } from "./types";

const FUNCTIONAL_EXERCISE_NAMES = [
  "skierg", "sled_push", "sled_pull", "burpee_broad_jump",
  "rowing", "farmers_carry", "sandbag_lunges", "wall_balls",
];

const EXERCISE_FOCUS_MAP: Record<string, string> = {
  "skierg": "skierg", "ski erg": "skierg", "ski-erg": "skierg",
  "sled push": "sled_push", "sled_push": "sled_push",
  "sled pull": "sled_pull", "sled_pull": "sled_pull",
  "burpee": "burpee_broad_jump", "burpee broad jump": "burpee_broad_jump", "burpee_broad_jump": "burpee_broad_jump",
  "rowing": "rowing", "row": "rowing",
  "farmers carry": "farmers_carry", "farmer carry": "farmers_carry", "farmers_carry": "farmers_carry",
  "sandbag lunges": "sandbag_lunges", "sandbag lunge": "sandbag_lunges", "sandbag_lunges": "sandbag_lunges",
  "wall balls": "wall_balls", "wall ball": "wall_balls", "wall_balls": "wall_balls",
  "running": "running", "run": "running",
};

const RUNNING_EXERCISE_NAMES = new Set(["easy_run", "tempo_run", "interval_run", "long_run"]);

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.round(Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

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

  return { rpeTrend, avgRpeLast3: avgLast3, avgRpePrior3: avgPrior3, fatigueFlag: avgLast3 >= 8, undertrainingFlag: avgLast3 <= 4 };
}

function updateLastTrained(record: Record<string, string | null>, key: string, date: string): void {
  const current = record[key];
  if (!current || date > current) {
    record[key] = date;
  }
}

function updateExerciseDatesFromSets(
  record: Record<string, string | null>,
  exerciseSets: NonNullable<TimelineEntry["exerciseSets"]>,
  date: string,
  allStations: string[],
): void {
  for (const es of exerciseSets) {
    const name = es.exerciseName.toLowerCase();
    if (allStations.includes(name)) updateLastTrained(record, name, date);
    if (RUNNING_EXERCISE_NAMES.has(name)) updateLastTrained(record, "running", date);
  }
}

function updateExerciseDatesFromFocus(record: Record<string, string | null>, focus: string, date: string): void {
  const focusLower = focus.toLowerCase();
  for (const [keyword, station] of Object.entries(EXERCISE_FOCUS_MAP)) {
    if (focusLower.includes(keyword)) updateLastTrained(record, station, date);
  }
}

export function computeExerciseGaps(timeline: TimelineEntry[]): NonNullable<TrainingContext["coachingInsights"]>["stationGaps"] {
  const today = toDateStr();
  const allStations = [...FUNCTIONAL_EXERCISE_NAMES, "running"];
  const lastTrainedDate: Record<string, string | null> = {};
  for (const station of allStations) lastTrainedDate[station] = null;

  for (const entry of timeline) {
    if (entry.status !== "completed" || !entry.date) continue;
    if (entry.exerciseSets) updateExerciseDatesFromSets(lastTrainedDate, entry.exerciseSets, entry.date, allStations);
    if (entry.focus) updateExerciseDatesFromFocus(lastTrainedDate, entry.focus, entry.date);
  }

  return allStations.map(station => {
    const last = lastTrainedDate[station];
    return { station, daysSinceLastTrained: last ? daysBetween(last, today) : null };
  });
}

export function computePlanPhase(
  totalWeeks: number,
  currentWeek: number,
): NonNullable<TrainingContext["coachingInsights"]>["planPhase"] {
  if (totalWeeks <= 0 || currentWeek <= 0) return undefined;

  const progressPct = Math.round((currentWeek / totalWeeks) * 100);

  let phaseLabel: "early" | "build" | "peak" | "taper" | "race_week";
  if (currentWeek >= totalWeeks) phaseLabel = "race_week";
  else if (progressPct >= 85) phaseLabel = "taper";
  else if (progressPct >= 60) phaseLabel = "peak";
  else if (progressPct >= 25) phaseLabel = "build";
  else phaseLabel = "early";

  return { currentWeek, totalWeeks, phaseLabel, progressPct };
}

export function computeWeeklyVolume(
  timeline: TimelineEntry[],
  weeklyGoal: number,
): NonNullable<TrainingContext["coachingInsights"]>["weeklyVolume"] {
  const today = new Date(toDateStr());
  const dayOfWeek = today.getDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() + mondayOffset);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);

  const thisMondayStr = toDateStr(thisMonday);
  const lastMondayStr = toDateStr(lastMonday);

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

function aggregateExercisePeaks(exerciseSets: NonNullable<TimelineEntry["exerciseSets"]>): Record<string, { maxWeight?: number; bestTime?: number }> {
  const perExercise: Record<string, { maxWeight?: number; bestTime?: number }> = {};
  for (const es of exerciseSets) {
    if (!perExercise[es.exerciseName]) perExercise[es.exerciseName] = {};
    const pe = perExercise[es.exerciseName];
    if (es.weight && (!pe.maxWeight || es.weight > pe.maxWeight)) pe.maxWeight = es.weight;
    if (es.time && (!pe.bestTime || es.time < pe.bestTime)) pe.bestTime = es.time;
  }
  return perExercise;
}

function collectExerciseHistory(timeline: TimelineEntry[]): Record<string, Array<{ date: string; maxWeight?: number; bestTime?: number }>> {
  const history: Record<string, Array<{ date: string; maxWeight?: number; bestTime?: number }>> = {};

  const completed = timeline
    .filter(e => e.status === "completed" && e.date && e.exerciseSets && e.exerciseSets.length > 0)
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
  if (recent3.every(w => w === recent3[0])) {
    return { exercise, flag: "plateau", detail: `Weight stuck at ${recent3[0]}kg for last ${recent3.length} sessions` };
  }
  if (recent3[2] > recent3[0]) {
    return { exercise, flag: "progressing", detail: `Weight increased from ${recent3[0]}kg to ${recent3[2]}kg over last 3 sessions` };
  }
  if (recent3[2] < recent3[0]) {
    return { exercise, flag: "regressing", detail: `Weight decreased from ${recent3[0]}kg to ${recent3[2]}kg over last 3 sessions` };
  }
  return null;
}

function analyzeTimeProgression(exercise: string, values: number[]): ProgressionFlag | null {
  if (values.length < 3) return null;
  const recent3 = values.slice(-3);
  if (recent3.every(t => Math.abs(t - recent3[0]) < 0.1)) {
    return { exercise, flag: "plateau", detail: `Time stuck at ${recent3[0]}min for last ${recent3.length} sessions` };
  }
  if (recent3[2] < recent3[0]) {
    return { exercise, flag: "progressing", detail: `Time improved from ${recent3[0]}min to ${recent3[2]}min over last 3 sessions` };
  }
  if (recent3[2] > recent3[0]) {
    return { exercise, flag: "regressing", detail: `Time worsened from ${recent3[0]}min to ${recent3[2]}min over last 3 sessions` };
  }
  return null;
}

export function computeProgressionFlags(timeline: TimelineEntry[]): NonNullable<TrainingContext["coachingInsights"]>["progressionFlags"] {
  const exerciseHistory = collectExerciseHistory(timeline);
  const flags: ProgressionFlag[] = [];

  for (const [exercise, history] of Object.entries(exerciseHistory)) {
    if (history.length === 1) {
      flags.push({ exercise, flag: "new", detail: `Only trained once (${history[0].date})` });
      continue;
    }
    if (history.length < 2) continue;

    // Single-pass extraction: collect weights and times in one O(N) traversal
    // instead of two separate .filter().map() chains (which allocate 4 intermediate arrays).
    const weights: number[] = [];
    const times: number[] = [];
    for (const h of history) {
      if (h.maxWeight != null) weights.push(h.maxWeight);
      if (h.bestTime != null) times.push(h.bestTime);
    }

    const weightFlag = analyzeWeightProgression(exercise, weights);
    if (weightFlag) { flags.push(weightFlag); continue; }

    const timeFlag = analyzeTimeProgression(exercise, times);
    if (timeFlag) flags.push(timeFlag);
  }

  return flags;
}

export function computeCurrentWeek(timeline: TimelineEntry[], totalWeeks: number): number {
  let earliestDate: string | null = null;
  for (const entry of timeline) {
    if (entry.weekNumber != null && entry.date) {
      if (!earliestDate || entry.date < earliestDate) {
        earliestDate = entry.date;
      }
    }
  }
  if (!earliestDate) return 1;

  const today = toDateStr();
  const days = daysBetween(earliestDate, today);
  const week = Math.max(1, Math.ceil((days + 1) / 7));
  return Math.min(week, totalWeeks);
}

import { storage } from "../storage";
import type { TrainingContext } from "../gemini/index";
import { calculateStreak } from "../routeUtils";
import { FUNCTIONAL_EXERCISES } from "../prompts";
import { toDateStr } from "../types";

import type { TimelineEntry as SharedTimelineEntry } from "@shared/schema";

type TimelineEntry = Pick<
  SharedTimelineEntry,
  "status" | "date" | "focus" | "mainWorkout" | "workoutLogId" | "exerciseSets" | "rpe" | "duration" | "weekNumber"
>;

function calculateTrainingStats(timeline: TimelineEntry[]) {
  let completedWorkouts = 0;
  let plannedWorkouts = 0;
  let missedWorkouts = 0;
  let skippedWorkouts = 0;
  const completedDates = new Set<string>();

  for (const entry of timeline) {
    if (entry.status === "completed") {
      completedWorkouts++;
      if (entry.date) completedDates.add(entry.date);
    } else if (entry.status === "planned") {
      plannedWorkouts++;
    } else if (entry.status === "missed") {
      missedWorkouts++;
    } else if (entry.status === "skipped") {
      skippedWorkouts++;
    }
  }

  const totalWorkouts = completedWorkouts + plannedWorkouts + missedWorkouts + skippedWorkouts;
  const denominator = completedWorkouts + missedWorkouts + skippedWorkouts;
  const completionRate = denominator > 0 ? Math.round((completedWorkouts / denominator) * 100) : 0;

  return { completedWorkouts, plannedWorkouts, missedWorkouts, skippedWorkouts, totalWorkouts, completionRate, completedDates };
}

const functionalRegex = new RegExp(FUNCTIONAL_EXERCISES.join('|'), 'gi');

function getExerciseBreakdown(timeline: TimelineEntry[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const entry of timeline) {
    if (entry.status === "completed" && entry.focus) {
      let matched = false;
      let match;
      functionalRegex.lastIndex = 0;

      // We only want to count each unique exercise ONCE per workout log entry
      // to match the previous string.includes() behavior.
      const seenInEntry = new Set<string>();

      while ((match = functionalRegex.exec(entry.focus)) !== null) {
        const exercise = match[0].toLowerCase();
        if (!seenInEntry.has(exercise)) {
          seenInEntry.add(exercise);
          breakdown[exercise] = (breakdown[exercise] || 0) + 1;
        }
        matched = true;
      }
      if (!matched) {
        breakdown[entry.focus] = (breakdown[entry.focus] || 0) + 1;
      }
    }
  }
  return breakdown;
}

function collectRecentWorkouts(timeline: TimelineEntry[]): TrainingContext["recentWorkouts"] {
  const recent: TrainingContext["recentWorkouts"] = [];
  for (const entry of timeline) {
    if (entry.status === "completed" && entry.date) {
      recent.push({
        date: entry.date,
        focus: entry.focus || "",
        mainWorkout: entry.mainWorkout || "",
        status: entry.status,
        rpe: entry.rpe,
        duration: entry.duration,
        exerciseDetails: entry.exerciseSets?.map(es => ({
          name: es.exerciseName,
          setNumber: es.setNumber,
          reps: es.reps,
          weight: es.weight,
          distance: es.distance,
          time: es.time,
        })),
      });
    }
  }
  // Fast string comparison for YYYY-MM-DD dates instead of localeCompare
  recent.sort((a, b) => {
    if (b.date < a.date) return -1;
    if (b.date > a.date) return 1;
    return 0;
  });
  return recent;
}

function updateExerciseStat(
  stat: { count: number; maxWeight?: number; maxDistance?: number; bestTime?: number; avgReps?: number },
  es: { weight: number | null; distance: number | null; time: number | null; reps: number | null }
) {
  stat.count++;
  if (es.weight) {
    if (!stat.maxWeight || es.weight > stat.maxWeight) stat.maxWeight = es.weight;
  }
  if (es.distance) {
    if (!stat.maxDistance || es.distance > stat.maxDistance) stat.maxDistance = es.distance;
  }
  if (es.time) {
    if (!stat.bestTime || es.time < stat.bestTime) stat.bestTime = es.time;
  }
  if (es.reps) {
    stat.avgReps = stat.avgReps
      ? Math.round((stat.avgReps * (stat.count - 1) + es.reps) / stat.count)
      : es.reps;
  }
}

function getStructuredExerciseStats(timeline: TimelineEntry[]) {
  const stats: Record<string, { count: number; maxWeight?: number; maxDistance?: number; bestTime?: number; avgReps?: number }> = {};
  let hasStats = false;

  for (const entry of timeline) {
    if (entry.status === "completed" && entry.exerciseSets) {
      for (const es of entry.exerciseSets) {
        hasStats = true;
        if (!stats[es.exerciseName]) stats[es.exerciseName] = { count: 0 };
        updateExerciseStat(stats[es.exerciseName], es);
      }
    }
  }

  return hasStats ? stats : undefined;
}

// ---------------------------------------------------------------------------
// Coaching Insights
// ---------------------------------------------------------------------------

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

function computeRpeTrend(recentWorkouts: TrainingContext["recentWorkouts"]): Pick<
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

function computeExerciseGaps(timeline: TimelineEntry[]): NonNullable<TrainingContext["coachingInsights"]>["stationGaps"] {
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

function computePlanPhase(
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

function computeWeeklyVolume(
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

function computeProgressionFlags(timeline: TimelineEntry[]): NonNullable<TrainingContext["coachingInsights"]>["progressionFlags"] {
  const exerciseHistory = collectExerciseHistory(timeline);
  const flags: ProgressionFlag[] = [];

  for (const [exercise, history] of Object.entries(exerciseHistory)) {
    if (history.length === 1) {
      flags.push({ exercise, flag: "new", detail: `Only trained once (${history[0].date})` });
      continue;
    }
    if (history.length < 2) continue;

    const weights = history.filter(h => h.maxWeight != null).map(h => h.maxWeight as number);
    const weightFlag = analyzeWeightProgression(exercise, weights);
    if (weightFlag) { flags.push(weightFlag); continue; }

    const times = history.filter(h => h.bestTime != null).map(h => h.bestTime as number);
    const timeFlag = analyzeTimeProgression(exercise, times);
    if (timeFlag) flags.push(timeFlag);
  }

  return flags;
}

function computeCurrentWeek(timeline: TimelineEntry[], totalWeeks: number): number {
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function buildTrainingContext(userId: string): Promise<TrainingContext> {
  const [timeline, plans, user] = await Promise.all([
    storage.getTimeline(userId),
    storage.listTrainingPlans(userId),
    storage.getUser(userId),
  ]);

  const { completedWorkouts, plannedWorkouts, missedWorkouts, skippedWorkouts, totalWorkouts, completionRate, completedDates } = calculateTrainingStats(timeline);
  const exerciseBreakdown = getExerciseBreakdown(timeline);
  const currentStreak = calculateStreak(completedDates);
  const recentWorkouts = collectRecentWorkouts(timeline);
  const structuredExerciseStats = getStructuredExerciseStats(timeline);

  let activePlan: TrainingContext["activePlan"];
  if (plans.length > 0) {
    const currentWeek = computeCurrentWeek(timeline, plans[0].totalWeeks);
    activePlan = { name: plans[0].name, totalWeeks: plans[0].totalWeeks, currentWeek, goal: plans[0].goal ?? undefined };
  }

  const rpeTrend = computeRpeTrend(recentWorkouts);
  const stationGaps = computeExerciseGaps(timeline);
  const weeklyGoal = user?.weeklyGoal ?? 0;
  const planPhase = activePlan
    ? computePlanPhase(activePlan.totalWeeks, activePlan.currentWeek ?? 1)
    : undefined;
  const weeklyVolume = weeklyGoal > 0 ? computeWeeklyVolume(timeline, weeklyGoal) : undefined;
  const progressionFlags = computeProgressionFlags(timeline);

  const coachingInsights: TrainingContext["coachingInsights"] = {
    ...rpeTrend,
    stationGaps,
    planPhase,
    weeklyVolume,
    progressionFlags,
  };

  return {
    totalWorkouts,
    completedWorkouts,
    plannedWorkouts,
    missedWorkouts,
    skippedWorkouts,
    completionRate,
    currentStreak,
    weeklyGoal: user?.weeklyGoal ?? undefined,
    recentWorkouts: recentWorkouts.slice(0, 10),
    exerciseBreakdown,
    structuredExerciseStats,
    activePlan,
    coachingInsights,
  };
}

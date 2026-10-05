import { addDaysToISODate, dayDiff } from "@shared/dateUtils";
import { singleDayWindow, type TrainingLoadWindow, type TrainingPhase } from "@shared/nutritionTargets";
import { estimatePlannedDayUtss } from "@shared/plannedSessionEstimate";
import type { WorkoutLog } from "@shared/schema";

import { storage } from "../../storage";
import { computePlanPhase } from "../ai/coachingInsights";
import { calculateTrainingLoad, type DailyTrainingLoad, EWMA_WARMUP_DAYS } from "../trainingLoadService";
import type { DailyUtss } from "./blockView";

/** What the load engine reads for one athlete over a span of days. */
interface LoadHistory {
  workoutLogs: WorkoutLog[];
  exerciseSets: Awaited<ReturnType<typeof storage.analytics.getAllExerciseSetsWithDates>>;
  loadTags: Awaited<ReturnType<typeof storage.analytics.getExerciseLoadTags>>;
  user: Awaited<ReturnType<typeof storage.users.getUser>>;
}

async function fetchLoadHistory(userId: string, from: string, to: string): Promise<LoadHistory> {
  const [workoutLogs, exerciseSets, loadTags, user] = await Promise.all([
    storage.analytics.getWorkoutLogsByDateRange(userId, from, to),
    storage.analytics.getAllExerciseSetsWithDates(userId, from, to),
    storage.analytics.getExerciseLoadTags(),
    storage.users.getUser(userId),
  ]);
  return { workoutLogs, exerciseSets, loadTags, user };
}

/** The load engine's per-day rows for `history` as of `currentDate`. */
function scoreDailyLoads(
  history: LoadHistory,
  currentDate: string,
  historyFrom?: string,
): DailyTrainingLoad[] {
  const { user } = history;
  return calculateTrainingLoad(history.workoutLogs, history.exerciseSets, history.loadTags, {
    currentDate,
    // Declares the true extent of what was fetched, so the EWMAs are withheld
    // rather than restarted if this range is ever narrowed again (audit H21).
    historyFrom,
    weightUnit: user?.weightUnit || "kg",
    distanceUnit: user?.distanceUnit || "km",
    athlete: {
      age: user?.age ?? null,
      gender: user?.gender ?? null,
      restingHr: user?.restingHr ?? null,
      // Scales unweighted-rep tonnage with the body being moved (audit M2).
      bodyweightKg: user?.bodyweightKg ?? null,
      maxHr: user?.maxHr ?? null,
      ftp: user?.ftp ?? null,
    },
  }).dailyLoads;
}

/**
 * Fetch a user's per-day training load (UTSS) over `[from, to]` inclusive plus
 * the raw workout logs the calculation read. Shared single source for the
 * daily-summary, block-view, and fuelling-range routes so the analytics fetch +
 * load call lives in exactly one place. The logs ride along for callers that
 * also need per-day outcomes (RPE/compliance) without a second fetch.
 */
export async function fetchDailyTraining(
  userId: string,
  from: string,
  to: string,
): Promise<{ dailyLoads: DailyUtss[]; workoutLogs: WorkoutLog[] }> {
  const history = await fetchLoadHistory(userId, from, to);
  return { dailyLoads: scoreDailyLoads(history, to), workoutLogs: history.workoutLogs };
}

/** Per-day UTSS only — see fetchDailyTraining. */
export async function fetchDailyUtss(
  userId: string,
  from: string,
  to: string,
): Promise<DailyUtss[]> {
  return (await fetchDailyTraining(userId, from, to)).dailyLoads;
}

// Trailing actual-load window (days) feeding the recovery signal, and how far
// ahead we look for a big planned session to pre-load for.
const RECOVERY_WINDOW_DAYS = 7;
const PRELOAD_HORIZON_DAYS = 2;
// A few upcoming planned days is plenty to cover the pre-load horizon.
const UPCOMING_FETCH_LIMIT = 5;
// The grid a window's load history starts on (see windowHistoryStart). Any
// fixed day serves as its origin; it only has to be the same for every request.
const HISTORY_GRID_DAYS = 28;
const HISTORY_GRID_ORIGIN = "2000-01-03";

/**
 * The day a window's load history starts on: the last grid boundary at least
 * the EWMA warmup before `date`.
 *
 * A day's window has to be the same whichever range asked for it: the daily
 * summary and the fuelling range used to build different ones, so the
 * Nutrition page and the Timeline chip showed different targets for the same
 * day. The EWMAs (and so the recovery signal's TSB) start at the first log in
 * whatever history the engine is fed, so one engine pass from the start of a
 * requested range would give each day a different history than a request for
 * that day alone. A start that depends only on the day keeps the two equal,
 * one engine pass still serves every day that shares it, and it always covers
 * the full warmup (audit H21). C31 (CODEBASE_ANALYSIS_2026-10-03)
 */
function windowHistoryStart(date: string): string {
  const earliest = addDaysToISODate(date, -Math.max(RECOVERY_WINDOW_DAYS, EWMA_WARMUP_DAYS));
  const offset = dayDiff(HISTORY_GRID_ORIGIN, earliest) % HISTORY_GRID_DAYS;
  return addDaysToISODate(earliest, -((offset + HISTORY_GRID_DAYS) % HISTORY_GRID_DAYS));
}

/** Ascending dates grouped by the day their load history starts on. */
function groupByHistoryStart(sortedDates: readonly string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const date of sortedDates) {
    const start = windowHistoryStart(date);
    const group = groups.get(start);
    if (group) group.push(date);
    else groups.set(start, [date]);
  }
  return groups;
}

/** `history` cut down to the logs (and their sets) dated within `[from, to]`. */
function historyBetween(history: LoadHistory, from: string, to: string): LoadHistory {
  const workoutLogs = history.workoutLogs.filter((log) => log.date >= from && log.date <= to);
  const logIds = new Set(workoutLogs.map((log) => log.id));
  const exerciseSets = history.exerciseSets.filter((set) => logIds.has(set.workoutLogId));
  return { ...history, workoutLogs, exerciseSets };
}

/** Plan phase + days-until-race for `date`, when an active plan covers it. */
function resolvePhase(
  activePlan: Awaited<ReturnType<typeof storage.plans.getActivePlan>>,
  date: string,
): { phase: TrainingPhase | null; daysUntilRace: number | null } {
  if (!activePlan) return { phase: null, daysUntilRace: null };
  const daysUntilRace = activePlan.raceDate
    ? Math.max(0, dayDiff(date, activePlan.raceDate))
    : null;
  const covers =
    activePlan.startDate != null &&
    activePlan.endDate != null &&
    activePlan.startDate <= date &&
    activePlan.endDate >= date;
  if (!covers || activePlan.startDate == null || activePlan.totalWeeks <= 0) {
    return { phase: null, daysUntilRace };
  }
  const weeksElapsed = Math.floor(dayDiff(activePlan.startDate, date) / 7);
  const currentWeek = Math.min(activePlan.totalWeeks, Math.max(1, weeksElapsed + 1));
  const phase = computePlanPhase(activePlan.totalWeeks, currentWeek)?.phaseLabel ?? null;
  return { phase, daysUntilRace };
}

/** The plan context a window's pre-load and phase read; the same for every day. */
interface FutureContext {
  plannedDays: Awaited<ReturnType<typeof storage.timeline.getUpcomingPlannedDays>>;
  activePlan: Awaited<ReturnType<typeof storage.plans.getActivePlan>>;
}

const NO_FUTURE: FutureContext = { plannedDays: [], activePlan: undefined };

async function fetchFutureContext(userId: string): Promise<FutureContext> {
  const [plannedDays, activePlan] = await Promise.all([
    storage.timeline.getUpcomingPlannedDays(userId, UPCOMING_FETCH_LIMIT),
    storage.plans.getActivePlan(userId),
  ]);
  return { plannedDays, activePlan };
}

/** Planned sessions inside `date`'s pre-load horizon, with their estimated load. */
function upcomingFrom(
  date: string,
  plannedDays: FutureContext["plannedDays"],
  distanceUnit: string | null,
): TrainingLoadWindow["upcoming"] {
  return plannedDays
    .map((d) => ({
      daysAhead: dayDiff(date, d.date),
      plannedUtss: estimatePlannedDayUtss({
        expectedDurationMin: d.expectedDurationMin,
        expectedRpe: d.expectedRpe,
        structureBlocks: d.structureBlocks,
        exerciseSets: d.exerciseSets,
        distanceUnit,
      }),
    }))
    .filter((u) => u.daysAhead >= 1 && u.daysAhead <= PRELOAD_HORIZON_DAYS);
}

function buildWindow(
  date: string,
  loadsByDate: ReadonlyMap<string, DailyTrainingLoad>,
  future: FutureContext,
  distanceUnit: string | null,
): TrainingLoadWindow {
  const today = loadsByDate.get(date);

  // Trailing calendar window INCLUDING rest days (0) so the recovery average
  // isn't biased upward by skipping non-training days.
  const recentLoads: number[] = [];
  for (let i = RECOVERY_WINDOW_DAYS; i >= 1; i--) {
    recentLoads.push(loadsByDate.get(addDaysToISODate(date, -i))?.utss ?? 0);
  }

  const { phase, daysUntilRace } = resolvePhase(future.activePlan, date);

  return {
    dayUtss: today?.utss ?? 0,
    recentLoads,
    acuteEwma: today?.acuteEwma ?? null,
    chronicEwma: today?.chronicEwma ?? null,
    tsb: today?.tsb ?? null,
    upcoming: upcomingFrom(date, future.plannedDays, distanceUnit),
    phase,
    daysUntilRace,
  };
}

/**
 * The training-load WINDOW each of `dates` reads for its effective target:
 * the day's own load + recent ACTUAL load (for recovery after hard days) +
 * upcoming PLANNED load and plan phase (for carb pre-loading / taper / race
 * week), so the target reflects PAST and FUTURE training, not just today.
 *
 * One batched read serves every date. The daily summary asks for one day and
 * the fuelling range for every adaptive day in view, and a day's window comes
 * out the same either way: its history starts where windowHistoryStart puts
 * it, not where the requested range does (C31).
 *
 * `includeFuture` is skipped when no future-facing knob is enabled, so the plan
 * and upcoming-day queries cost nothing for recovery-only users. Missing data
 * (no plan, no history) degrades gracefully to a near-empty window — i.e. the
 * original single-day behaviour.
 */
export async function fetchTrainingLoadWindows(
  userId: string,
  dates: readonly string[],
  opts: { includeFuture: boolean },
): Promise<Map<string, TrainingLoadWindow>> {
  const windows = new Map<string, TrainingLoadWindow>();
  const sorted = [...new Set(dates)].sort((left, right) => (left < right ? -1 : 1));
  const first = sorted.at(0);
  const last = sorted.at(-1);
  if (first === undefined || last === undefined) return windows;

  // The whole span's history is read once, back to the first day's history
  // start: the EWMA warmup, not just the recovery window. `recentLoads` still
  // reads only the trailing RECOVERY_WINDOW_DAYS, but fetching 7 days handed
  // the effective target a "28-day chronic baseline" built from one week: a
  // taper after eight heavy weeks reported 26.1 against a true 107.2 (audit H21).
  const [history, future] = await Promise.all([
    fetchLoadHistory(userId, windowHistoryStart(first), last),
    opts.includeFuture ? fetchFutureContext(userId) : Promise.resolve(NO_FUTURE),
  ]);
  const distanceUnit = history.user?.distanceUnit ?? null;

  for (const [start, group] of groupByHistoryStart(sorted)) {
    const end = group.at(-1) ?? start;
    const loads = scoreDailyLoads(historyBetween(history, start, end), end, start);
    const loadsByDate = new Map(loads.map((load) => [load.date, load]));
    for (const date of group) {
      windows.set(date, buildWindow(date, loadsByDate, future, distanceUnit));
    }
  }
  return windows;
}

/** One day's window — see fetchTrainingLoadWindows. */
export async function fetchTrainingLoadWindow(
  userId: string,
  date: string,
  opts: { includeFuture: boolean },
): Promise<TrainingLoadWindow> {
  const windows = await fetchTrainingLoadWindows(userId, [date], opts);
  return windows.get(date) ?? singleDayWindow(0);
}

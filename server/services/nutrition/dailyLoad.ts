import { addDaysToISODate, dayDiff } from "@shared/dateUtils";
import type { TrainingLoadWindow, TrainingPhase } from "@shared/nutritionTargets";
import { estimatePlannedDayUtss } from "@shared/plannedSessionEstimate";
import type { WorkoutLog } from "@shared/schema";

import { storage } from "../../storage";
import { computePlanPhase } from "../ai/coachingInsights";
import { calculateTrainingLoad, type DailyTrainingLoad, EWMA_WARMUP_DAYS } from "../trainingLoadService";
import type { DailyUtss } from "./blockView";

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
  const [workoutLogs, exerciseSets, loadTags, user] = await Promise.all([
    storage.analytics.getWorkoutLogsByDateRange(userId, from, to),
    storage.analytics.getAllExerciseSetsWithDates(userId, from, to),
    storage.analytics.getExerciseLoadTags(),
    storage.users.getUser(userId),
  ]);
  return {
    dailyLoads: calculateTrainingLoad(workoutLogs, exerciseSets, loadTags, {
      currentDate: to,
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
    }).dailyLoads,
    workoutLogs,
  };
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

/**
 * Per-day FULL training load (utss + acute/chronic EWMA + TSB) over `[from, to]`.
 * Unlike {@link fetchDailyUtss} this keeps the fitness/fatigue signals the load
 * engine already computes, which the recovery part of the effective target reads.
 */
export async function fetchDailyTrainingLoad(
  userId: string,
  from: string,
  to: string,
): Promise<DailyTrainingLoad[]> {
  const [workoutLogs, exerciseSets, loadTags, user] = await Promise.all([
    storage.analytics.getWorkoutLogsByDateRange(userId, from, to),
    storage.analytics.getAllExerciseSetsWithDates(userId, from, to),
    storage.analytics.getExerciseLoadTags(),
    storage.users.getUser(userId),
  ]);
  return calculateTrainingLoad(workoutLogs, exerciseSets, loadTags, {
    currentDate: to,
    // Declares the true extent of what was fetched, so the EWMAs are withheld
    // rather than reseeded if this range is ever narrowed again (audit H21).
    historyFrom: from,
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

/**
 * Assemble the training-load WINDOW the daily-summary effective target consumes:
 * the day's own load + recent ACTUAL load (for recovery after hard days) +
 * upcoming PLANNED load and plan phase (for carb pre-loading / taper / race
 * week), so the target reflects PAST and FUTURE training, not just today.
 *
 * `includeFuture` is skipped when no future-facing knob is enabled, so the plan
 * and upcoming-day queries cost nothing for recovery-only users. Missing data
 * (no plan, no history) degrades gracefully to a near-empty window — i.e. the
 * original single-day behaviour.
 */
export async function fetchTrainingLoadWindow(
  userId: string,
  date: string,
  opts: { includeFuture: boolean },
): Promise<TrainingLoadWindow> {
  // Fetch the EWMA warmup, not just the recovery window. `recentLoads` below
  // still reads only the trailing RECOVERY_WINDOW_DAYS, but acuteEwma and
  // chronicEwma are seeded at the first log in whatever range is fetched — so
  // fetching 7 days handed the effective target a "28-day chronic baseline"
  // built from one week. A taper after eight heavy weeks reported 26.1 against
  // a true 107.2, scaling the athlete's fuelling off a quarter of their real
  // baseline at exactly the moment fuelling matters (audit H21).
  const from = addDaysToISODate(date, -Math.max(RECOVERY_WINDOW_DAYS, EWMA_WARMUP_DAYS));
  const loadsPromise = fetchDailyTrainingLoad(userId, from, date);

  let plannedDays: Awaited<ReturnType<typeof storage.timeline.getUpcomingPlannedDays>> = [];
  let activePlan: Awaited<ReturnType<typeof storage.plans.getActivePlan>> = undefined;
  let user: Awaited<ReturnType<typeof storage.users.getUser>> = undefined;
  if (opts.includeFuture) {
    [plannedDays, activePlan, user] = await Promise.all([
      storage.timeline.getUpcomingPlannedDays(userId, UPCOMING_FETCH_LIMIT),
      storage.plans.getActivePlan(userId),
      storage.users.getUser(userId),
    ]);
  }
  const loads = await loadsPromise;

  const utssByDate = new Map(loads.map((l) => [l.date, l.utss]));
  const today = loads.find((l) => l.date === date) ?? null;

  // Trailing calendar window INCLUDING rest days (0) so the recovery average
  // isn't biased upward by skipping non-training days.
  const recentLoads: number[] = [];
  for (let i = RECOVERY_WINDOW_DAYS; i >= 1; i--) {
    recentLoads.push(utssByDate.get(addDaysToISODate(date, -i)) ?? 0);
  }

  const distanceUnit = user?.distanceUnit ?? null;
  const upcoming = plannedDays
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

  const { phase, daysUntilRace } = resolvePhase(activePlan, date);

  return {
    dayUtss: today?.utss ?? 0,
    recentLoads,
    acuteEwma: today?.acuteEwma ?? null,
    chronicEwma: today?.chronicEwma ?? null,
    tsb: today?.tsb ?? null,
    upcoming,
    phase,
    daysUntilRace,
  };
}

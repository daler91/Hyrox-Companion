import type { TrainingLoadWindow, TrainingPhase } from "@shared/nutritionTargets";
import { estimatePlannedDayUtss } from "@shared/plannedSessionEstimate";
import type { WorkoutLog } from "@shared/schema";

import { storage } from "../../storage";
import { computePlanPhase } from "../ai/coachingInsights";
import { calculateTrainingLoad, type DailyTrainingLoad } from "../trainingLoadService";
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
      athlete: {
        age: user?.age ?? null,
        gender: user?.gender ?? null,
        restingHr: user?.restingHr ?? null,
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

/** Shift a YYYY-MM-DD calendar date by whole days (UTC-anchored, DST-safe). */
function shiftDateStr(date: string, deltaDays: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
function daysBetweenStr(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

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
    weightUnit: user?.weightUnit || "kg",
    athlete: {
      age: user?.age ?? null,
      gender: user?.gender ?? null,
      restingHr: user?.restingHr ?? null,
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
    ? Math.max(0, daysBetweenStr(date, activePlan.raceDate))
    : null;
  const covers =
    activePlan.startDate != null &&
    activePlan.endDate != null &&
    activePlan.startDate <= date &&
    activePlan.endDate >= date;
  if (!covers || activePlan.startDate == null || activePlan.totalWeeks <= 0) {
    return { phase: null, daysUntilRace };
  }
  const weeksElapsed = Math.floor(daysBetweenStr(activePlan.startDate, date) / 7);
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
  const from = shiftDateStr(date, -RECOVERY_WINDOW_DAYS);
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
    recentLoads.push(utssByDate.get(shiftDateStr(date, -i)) ?? 0);
  }

  const distanceUnit = user?.distanceUnit ?? null;
  const upcoming = plannedDays
    .map((d) => ({
      daysAhead: daysBetweenStr(date, d.date),
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

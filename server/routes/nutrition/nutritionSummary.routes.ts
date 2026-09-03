import { applyMealTargetOverrides, computeMealFuelTargets, DEFAULT_MEAL_SCHEDULE, type MealFuelOverride, type MealFuelTargets, type MealScheduleCount, type WorkoutTiming } from "@shared/mealFuelling";
import { singleDayWindow } from "@shared/nutritionTargets";
import {
  type BlockViewQuery,
  blockViewQuerySchema,
  type BlockViewResponse,
  type DailySummaryQuery,
  dailySummaryQuerySchema,
  type DailySummaryResponse,
  type EffectiveTargetSummary,
  type FuellingRangeResponse,
  type MealType,
  type SessionFuellingGap,
  type SessionFuellingResponse,
} from "@shared/schema";
import { computeSessionFuellingTarget } from "@shared/sessionFuellingTargets";
import { type Request, type Response, Router } from "express";

import { isAuthenticated } from "../../clerkAuth";
import { asyncHandler, rateLimiter, sendNotFound, validateQuery } from "../../routeUtils";
import { buildBlockView, type DailyUtss } from "../../services/nutrition/blockView";
import { fetchDailyTraining, fetchDailyUtss, fetchTrainingLoadWindow } from "../../services/nutrition/dailyLoad";
import { resolveDayEnergy } from "../../services/nutrition/energy";
import { buildEffectiveTargetSummary, buildFuellingRange, decorateBlockPointsWithOutcomes } from "../../services/nutrition/fuellingRange";
import { buildDailySummary } from "../../services/nutrition/rollup";
import {
  computeSessionFuelling,
  POST_WINDOW_MS,
  PRE_WINDOW_MS,
} from "../../services/nutrition/sessionFuelling";
import { getPlannedSessionEstimate } from "../../services/sessionEstimate/plannedSessionEstimate";
import { storage } from "../../storage";
import { getLocalDateStr, getLocalHour } from "../../timezone";
import { getUserId } from "../../types";
import { getUserTimezone } from "./shared";

// Day and range read models (FR-1.3, FR-3.1 to FR-3.4, Phase 2 timeline, Phase
// 3b): the daily summary with its effective and per-meal targets, the block
// view, the fuelling range, and the per-session fuelling analyses.

/**
 * Resolve the effective target for one day: the user's baseline target (the
 * version effective on that date), made training-aware when periodisation is on.
 * Carbs/calories (and protein, on recovery days) flex with a window of training:
 * today's load, recent ACTUAL load (recovery after hard days), and upcoming
 * PLANNED load + plan phase (carb pre-loading / taper / race week). Returns null
 * when no target is set.
 *
 * Cost-gated: a flat target pays nothing; a load-only periodised target keeps the
 * original cheap single-day query; the recent/upcoming/plan fetches run only when
 * a recovery or future-facing knob is actually enabled.
 */
async function resolveEffectiveTarget(
  userId: string,
  logDate: string,
): Promise<EffectiveTargetSummary | null> {
  const baseline = await storage.nutrition.getCurrentTarget(userId, logDate);
  if (!baseline) return null;
  if (!baseline.periodizationEnabled) {
    return buildEffectiveTargetSummary(baseline, singleDayWindow(0));
  }

  const needRecovery = baseline.recoveryEnabled ?? false;
  const includeFuture =
    (baseline.preloadCarbGramsPerUtss ?? 0) > 0 || (baseline.phaseAware ?? false);
  if (!needRecovery && !includeFuture) {
    // Load-only periodisation: today's UTSS is all that matters.
    const dailyLoads = await fetchDailyUtss(userId, logDate, logDate);
    const dayUtss = dailyLoads.find((d) => d.date === logDate)?.utss ?? 0;
    return buildEffectiveTargetSummary(baseline, singleDayWindow(dayUtss));
  }

  const window = await fetchTrainingLoadWindow(userId, logDate, { includeFuture });
  return buildEffectiveTargetSummary(baseline, window);
}

/** Round to 1 dp — the macro display precision used across the nutrition surface. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

interface DayTrainingContext {
  durationMin: number | null;
  rpe: number | null;
  hasWorkout: boolean;
  timing: WorkoutTiming;
}

/** Intensity-weighted volume, to pick the day's primary session for fuelling.
 *  Unknown RPE assumes a moderate 5 (matches the session calculator's default). */
function sessionSignificance(durationMin: number | null, rpe: number | null): number {
  return (durationMin ?? 0) * (rpe ?? 5);
}

function pickPrimary<T>(items: T[], score: (item: T) => number): T {
  let best = items[0];
  let bestScore = score(best);
  for (let i = 1; i < items.length; i++) {
    const s = score(items[i]);
    if (s > bestScore) {
      best = items[i];
      bestScore = s;
    }
  }
  return best;
}

/** Map a session's local hour to a meal-timing bucket. Unknown time defaults to
 *  the morning assumption so users who set no time keep the prior behaviour. */
function timingFromLocalHour(hour: number | null): WorkoutTiming {
  if (hour == null || hour < 11) return "am_pre_breakfast";
  if (hour < 15) return "midday";
  return "evening";
}

/** Local hour (0–23) from minutes-from-midnight, or null when unset. */
function minutesToLocalHour(min: number | null | undefined): number | null {
  return min == null ? null : Math.floor(min / 60);
}

/**
 * The day's primary training session for the per-meal fuel targets: the most
 * significant LOGGED workout, else the most significant PLANNED day (so a
 * morning's targets show before the session is logged), else a rest day. The
 * session's local time-of-day — device `startedAt`, manual `timeOfDayMin`, or the
 * plan day's `plannedTimeOfDayMin` — selects the morning/midday/evening timing.
 */
async function resolveDayTrainingContext(
  userId: string,
  logDate: string,
  tz: string,
): Promise<DayTrainingContext> {
  const logged = await storage.analytics.getWorkoutLogsByDateRange(userId, logDate, logDate);
  if (logged.length > 0) {
    const primary = pickPrimary(logged, (w) => sessionSignificance(w.duration ?? null, w.rpe ?? null));
    const hour =
      primary.startedAt != null
        ? getLocalHour(primary.startedAt, tz)
        : minutesToLocalHour(primary.timeOfDayMin);
    return {
      durationMin: primary.duration ?? null,
      rpe: primary.rpe ?? null,
      hasWorkout: true,
      timing: timingFromLocalHour(hour),
    };
  }
  const planned = await storage.analytics.getPlannedDaysForDate(userId, logDate);
  if (planned.length > 0) {
    const primary = pickPrimary(planned, (p) => sessionSignificance(p.expectedDurationMin, p.expectedRpe));
    return {
      durationMin: primary.expectedDurationMin,
      rpe: primary.expectedRpe,
      hasWorkout: true,
      timing: timingFromLocalHour(minutesToLocalHour(primary.plannedTimeOfDayMin)),
    };
  }
  return { durationMin: null, rpe: null, hasWorkout: false, timing: "none" };
}

/**
 * The day's per-meal fuel targets: distribute the effective daily target across
 * meals with the primary session's pre/post anchors placed first. Called only
 * when an effective target exists, so the (cheap, single-day) workout/plan
 * lookups stay gated. Returns null only when the target carries no macros at all.
 */
/** Coerce the stored meal_schedule (3/4/5, nullable) to a valid count. */
function normalizeMealSchedule(value: number | null | undefined): MealScheduleCount {
  return value === 3 || value === 5 ? value : DEFAULT_MEAL_SCHEDULE;
}

async function resolveMealFuelTargets(userId: string, logDate: string, effectiveTarget: EffectiveTargetSummary, bodyweightKg: number | null, tz: string, mealSchedule: MealScheduleCount): Promise<MealFuelTargets | null> {
  const [training, overrides] = await Promise.all([
    resolveDayTrainingContext(userId, logDate, tz),
    storage.nutrition.getMealTargetOverrides(userId, logDate),
  ]);
  const session = training.hasWorkout
    ? computeSessionFuellingTarget({ durationMin: training.durationMin, rpe: training.rpe, bodyweightKg })
    : null;
  const computed = computeMealFuelTargets({
    daily: {
      calories: effectiveTarget.calories,
      proteinG: effectiveTarget.proteinG,
      carbG: effectiveTarget.carbG,
      fatG: effectiveTarget.fatG,
    },
    session,
    bodyweightKg,
    workoutTiming: training.timing,
    hasWorkout: training.hasWorkout,
    mealSchedule,
  });
  // Layer any per-meal overrides on top of the computed split (active meals only).
  if (!computed || overrides.size === 0) return computed;
  const overrideMap: Partial<Record<MealType, MealFuelOverride>> = {};
  for (const [meal, row] of overrides) {
    overrideMap[meal] = { calories: row.calories, carbG: row.carbG, proteinG: row.proteinG, fatG: row.fatG };
  }
  return applyMealTargetOverrides(computed, overrideMap);
}

/**
 * FR-1.3 — the daily view: running totals + entries bucketed by meal, the day's
 * effective target, per-meal fuel targets, and the energy balance. One user
 * fetch drives both the local "today" and the fuelling bodyweight.
 */
async function handleDailySummary(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const { date } = req.query as unknown as DailySummaryQuery;

  // ⚡ Bolt: Parallelize independent DB reads when the date is provided in the query.
  let user;
  let logDate;
  let rows;
  if (date) {
    logDate = date;
    [user, rows] = await Promise.all([
      storage.users.getUser(userId),
      storage.nutrition.listEntriesWithFoodForDate(userId, date),
    ]);
  } else {
    user = await storage.users.getUser(userId);
    logDate = getLocalDateStr(new Date(), user?.userTimezone ?? "UTC");
    rows = await storage.nutrition.listEntriesWithFoodForDate(userId, logDate);
  }

  const base = buildDailySummary(logDate, rows);
  const [effectiveTarget, energy] = await Promise.all([
    resolveEffectiveTarget(userId, logDate),
    resolveDayEnergy(userId, logDate, base.totals.calories),
  ]);
  // Per-meal fuel targets ride on the day's effective target; gated on one
  // existing so flat-target / no-target users pay nothing extra.
  const mealTargets = effectiveTarget
    ? await resolveMealFuelTargets(userId, logDate, effectiveTarget, user?.bodyweightKg ?? null, user?.userTimezone ?? "UTC", normalizeMealSchedule(user?.mealSchedule))
    : null;
  const summary: DailySummaryResponse = { ...base, effectiveTarget, mealTargets, energy };
  res.json(summary);
}

/**
 * FR-3.3 + Roadmap G — the block view's per-day points: intake macros + UTSS,
 * decorated with the day's carb target / RPE / compliance so the Fuelling tab
 * can correlate fuelling with performance without another endpoint.
 */
async function buildDecoratedBlockPoints(
  userId: string,
  from: string,
  to: string,
): Promise<BlockViewResponse["points"]> {
  const [rows, training, targets] = await Promise.all([
    storage.nutrition.listEntriesWithFoodForDateRange(userId, from, to),
    fetchDailyTraining(userId, from, to),
    storage.nutrition.listTargets(userId),
  ]);
  return decorateBlockPointsWithOutcomes(
    buildBlockView(rows, training.dailyLoads, { from, to }),
    training.workoutLogs,
    targets,
    training.dailyLoads,
  );
}

/**
 * System estimate (distance-aware + personalized from logged run pace + a small AI
 * nudge) of a planned session's duration/effort, to prefill the fuelling panel. The
 * client layers the athlete's saved overrides on top. userId-scoped: a foreign/missing
 * plan day resolves to null → 404 (no leak).
 */
async function handlePlannedSessionEstimate(
  req: Request<{ planDayId: string }>,
  res: Response,
): Promise<void> {
  const estimate = await getPlannedSessionEstimate(req.params.planDayId, getUserId(req));
  if (!estimate) {
    sendNotFound(res, "Plan day not found");
    return;
  }
  res.json(estimate);
}

function registerPlannedSessionEstimateRoute(router: Router): void {
  router.get(
    "/api/v1/nutrition/planned-session-estimate/:planDayId",
    isAuthenticated,
    rateLimiter("nutritionRead", 60),
    asyncHandler(handlePlannedSessionEstimate),
  );
}

export function registerNutritionSummaryRoutes(router: Router): void {
  // FR-1.3 — daily view: running totals + entries bucketed by meal.
  router.get(
    "/api/v1/nutrition/summary",
    isAuthenticated,
    rateLimiter("nutritionRead", 60),
    validateQuery(dailySummaryQuerySchema),
    asyncHandler(handleDailySummary),
  );

  // ---- Phase 3 (Integration): relate fuelling to training ------------------

  // FR-3.1/3.2/3.4 — a session's surrounding entries, split pre/post. When the
  // workout has a true start instant (from Strava/Garmin) we window by time;
  // otherwise we fall back to that day's pre_workout/post_workout meal tags.
  router.get(
    "/api/v1/nutrition/session-fuelling/:workoutId",
    isAuthenticated,
    rateLimiter("nutritionRead", 60),
    asyncHandler(async (req: Request<{ workoutId: string }>, res: Response) => {
      const userId = getUserId(req);
      // userId-scoped: a foreign workout resolves to undefined → 404 (no leak).
      const workout = await storage.workouts.getWorkoutLog(req.params.workoutId, userId);
      if (!workout) {
        sendNotFound(res, "Workout not found");
        return;
      }

      // With a real start instant, fetch the clock window PLUS the session
      // day's entries: a back-logged meal is stamped local noon, which can fall
      // outside the window even though its pre/post_workout tag names this
      // session. computeSessionFuelling attributes same-day tags first, then
      // windows the rest.
      const [user, entries] = await Promise.all([
        storage.users.getUser(userId),
        workout.startedAt
          ? Promise.all([
              storage.nutrition.listEntriesWithFoodInWindow(
                userId,
                new Date(workout.startedAt.getTime() - PRE_WINDOW_MS),
                new Date(workout.startedAt.getTime() + POST_WINDOW_MS),
              ),
              storage.nutrition.listEntriesWithFoodForDate(userId, workout.date),
            ]).then(([windowEntries, dayEntries]) => {
              const byId = new Map(windowEntries.map((e) => [e.id, e]));
              for (const e of dayEntries) if (!byId.has(e.id)) byId.set(e.id, e);
              return [...byId.values()];
            })
          : storage.nutrition.listEntriesWithFoodForDate(userId, workout.date),
      ]);

      const fuelling = computeSessionFuelling(workout, entries);
      // Recommended fuelling for this session (guidance), and how far the logged
      // pre/post intake is from it. Always present — the calculator falls back to
      // sensible defaults when duration/RPE/bodyweight are missing.
      const target = computeSessionFuellingTarget({
        durationMin: workout.duration ?? null,
        rpe: workout.rpe ?? null,
        bodyweightKg: user?.bodyweightKg ?? null,
      });
      const gap: SessionFuellingGap = {
        preCarbG: round1(target.preCarbG - fuelling.preTotals.carb),
        postCarbG: round1(target.postCarbG - fuelling.postTotals.carb),
        postProteinG: round1(target.postProteinG - fuelling.postTotals.protein),
      };

      const response: SessionFuellingResponse = {
        workoutId: workout.id,
        date: workout.date,
        ...fuelling,
        target,
        gap,
      };
      res.json(response);
    }),
  );

  // Phase 3b — planned-session duration/effort estimate to prefill the fuelling panel.
  registerPlannedSessionEstimateRoute(router);

  // FR-3.3 — block view: daily intake macros vs training UTSS over a range.
  // Calls calculateTrainingLoad directly for the FULL range (training-overview's
  // trend is hard-capped at 42 days), reusing the same analytics storage.
  router.get(
    "/api/v1/nutrition/block",
    isAuthenticated,
    rateLimiter("nutritionRead", 60),
    validateQuery(blockViewQuerySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const { from, to: toParam } = req.query as unknown as BlockViewQuery;
      const to = toParam ?? getLocalDateStr(new Date(), await getUserTimezone(userId));

      const response: BlockViewResponse = {
        from,
        to,
        points: await buildDecoratedBlockPoints(userId, from, to),
      };
      res.json(response);
    }),
  );

  // Phase 2 (Timeline integration) — per-day fuelling progress (intake totals,
  // load-adjusted effective target, post-workout-meal flag) for the home-screen
  // chips. One batched read for the whole visible window (no per-day fan-out):
  // the day's training load is only computed when a periodised target exists, so
  // flat-target and no-target users pay nothing extra.
  router.get(
    "/api/v1/nutrition/summary-range",
    isAuthenticated,
    rateLimiter("nutritionRead", 60),
    validateQuery(blockViewQuerySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const { from, to: toParam } = req.query as unknown as BlockViewQuery;
      const to = toParam ?? getLocalDateStr(new Date(), await getUserTimezone(userId));

      const targets = await storage.nutrition.listTargets(userId);
      const needLoad = targets.some((t) => t.periodizationEnabled);
      const [rows, dailyLoads] = await Promise.all([
        storage.nutrition.listEntriesWithFoodForDateRange(userId, from, to),
        needLoad ? fetchDailyUtss(userId, from, to) : Promise.resolve<DailyUtss[]>([]),
      ]);

      const response: FuellingRangeResponse = {
        from,
        to,
        days: buildFuellingRange(rows, dailyLoads, targets, { from, to }),
      };
      res.json(response);
    }),
  );
}

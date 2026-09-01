import crypto from "node:crypto";

import { dateStringSchema, type RacePredictionResponse, weeklyReviewIntentSchema, type WorkoutLog } from "@shared/schema";
import { sql } from "drizzle-orm";
import { type NextFunction, type Request as ExpressRequest, type Request, type Response,Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../clerkAuth";
import { db } from "../db";
import { env } from "../env";
import { reqLogger } from "../logger";
import { asyncHandler, rateLimiter, validateBody } from "../routeUtils";
import { computeStale, getWorkoutAnchor, regenerateAndStoreRacePrediction } from "../services/analyticsPersistence";
import { type CacheEntry, createCoalescedCache } from "../services/analyticsRouteCache";
import { calculateExerciseAnalytics, calculatePersonalRecords, type ExerciseSetWithDate } from "../services/analyticsService";
import { assembleTrainingOverview, todayUtcYyyyMmDd } from "../services/trainingOverviewLoader";
import { getWeekRangeForDate } from "../services/weeklyProgress";
import { buildWeeklyReview, isWeekParamValid } from "../services/weeklyReviewService";
import { storage } from "../storage";
import type { SlimLoggedExerciseSet } from "../storage/shared";
import { getUserId } from "../types";
import { protectedPost } from "./_helpers/protectedRouteBuilder";

const router = Router();


// Exercise-sets cache. Exported for testing only so tests can clear it.
export const _cacheForTesting = new Map<string, CacheEntry<ExerciseSetWithDate[]>>();
const getExerciseSetsCoalesced = createCoalescedCache(
  _cacheForTesting,
  "",
  (userId, from, to) => storage.analytics.getAllExerciseSetsWithDates(userId, from, to),
);

// Personal Records use a column-slim fetch (only the fields calculatePersonalRecords
// reads), so they get their own coalesced cache namespaced with `pr-`.
export const _prCacheForTesting = new Map<string, CacheEntry<SlimLoggedExerciseSet[]>>();
const getPersonalRecordSetsCoalesced = createCoalescedCache(
  _prCacheForTesting,
  "pr-",
  (userId, from, to) => storage.analytics.getExerciseSetsForPersonalRecords(userId, from, to),
);

export function validDate(val: unknown): string | undefined {
  if (!val) return undefined;
  const parsed = dateStringSchema.safeParse(val);
  return parsed.success ? parsed.data : undefined;
}

type DateQuery = { from?: string; to?: string };
type DateReq = ExpressRequest<Record<string, never>, unknown, unknown, DateQuery>;

// UTC calendar-day helpers now live in services/trainingOverviewLoader (shared
// with the Overview AI analysis path so both compute the same windows).
// Re-exported here so the existing analytics route tests keep importing them
// from this module.
export { addCalendarDays, todayUtcYyyyMmDd } from "../services/trainingOverviewLoader";

function parseDateParams(req: DateReq, res: Response): { from?: string; to?: string } | null {
  const from = validDate(req.query.from);
  const rawTo = validDate(req.query.to);

  if (req.query.from && !from) {
    res.status(400).json({ error: "Invalid 'from' date format", code: "BAD_REQUEST" });
    return null;
  }
  if (req.query.to && !rawTo) {
    res.status(400).json({ error: "Invalid 'to' date format", code: "BAD_REQUEST" });
    return null;
  }
  // Clamp a future `to` to today so `?to=2099-01-01` can't silently
  // return an empty window. The cost of a silent empty-result reply is
  // worse than a visible off-by-one on the upper bound.
  const today = todayUtcYyyyMmDd();
  const to = rawTo && rawTo > today ? today : rawTo;
  return { from, to };
}

function secretsMatch(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const providedHash = crypto.createHash("sha256").update(provided).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(providedHash, expectedHash);
}

function requireInternalAnalyticsSecret(req: ExpressRequest, res: Response, next: NextFunction): void {
  const header = req.headers["x-internal-analytics-secret"];
  const provided = Array.isArray(header) ? undefined : header;
  if (!secretsMatch(provided, env.INTERNAL_ANALYTICS_SECRET)) {
    res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
    return;
  }
  next();
}

type WeekQuery = { week?: string };
type WeekReq = ExpressRequest<Record<string, never>, unknown, unknown, WeekQuery>;

// The athlete's own Monday→Sunday week. `?week=` accepts any date inside the
// wanted week (see resolveReviewWeek) and defaults to the last completed one.
// Not persisted and not AI-gated: it is four bounded queries over data the
// weekly summary email already reads once a week.
router.get("/api/v1/weekly-review", isAuthenticated, rateLimiter("analytics", 20), asyncHandler(async (req: WeekReq, res: Response) => {
    const userId = getUserId(req);
    const { week } = req.query;

    if (week !== undefined && !isWeekParamValid(week)) {
      res.status(400).json({ error: "Invalid 'week' date format", code: "BAD_REQUEST" });
      return;
    }

    res.json(await buildWeeklyReview(storage, userId, { week }));
  }));

// Write (or clear) the athlete's intent for a week. Keyed on the same week the
// review is keyed on, so the row the GET reads back is the row this wrote.
// POST rather than PUT despite being an idempotent upsert: the repo has no PUT
// routes and the route-builder/compliance test only knows post/patch/delete.
protectedPost(
  router,
  "/api/v1/weekly-review/intent",
  { limiter: rateLimiter("analytics", 20), middleware: [validateBody(weeklyReviewIntentSchema)] },
  async (req: Request<Record<string, never>, unknown, z.infer<typeof weeklyReviewIntentSchema>>, res: Response) => {
    const userId = getUserId(req);
    const { week, intent } = req.body;

    // Anchor to the Monday rather than trusting the client to send one: the
    // unique index is on (user_id, week_start), so a mid-week date would open
    // a second row for a week that must only ever hold one intent.
    const { weekStart } = getWeekRangeForDate(week);
    const trimmed = intent?.trim() ?? "";
    const row = await storage.weeklyReviews.setIntent(userId, weekStart, trimmed === "" ? null : trimmed);

    res.json({ weekStart: row.weekStart, intent: row.intent });
  },
);

router.get("/api/v1/personal-records", isAuthenticated, rateLimiter("analytics", 20), asyncHandler(async (req: DateReq, res: Response) => {
    const userId = getUserId(req);
    const dates = parseDateParams(req, res);
    if (!dates) return;

    // Preferences are read per request, not cached with the sets: the caches
    // hold raw stamped rows and conversion happens here, so a unit switch is
    // reflected on the next request instead of after the cache TTL.
    const [prSets, user] = await Promise.all([
      getPersonalRecordSetsCoalesced(userId, dates.from, dates.to),
      storage.users.getUser(userId),
    ]);
    res.json(calculatePersonalRecords(prSets, { weightUnit: user?.weightUnit, distanceUnit: user?.distanceUnit }));
  }));

router.get("/api/v1/exercise-analytics", isAuthenticated, rateLimiter("analytics", 20), asyncHandler(async (req: DateReq, res: Response) => {
    const userId = getUserId(req);
    const dates = parseDateParams(req, res);
    if (!dates) return;

    const [allSets, user] = await Promise.all([
      getExerciseSetsCoalesced(userId, dates.from, dates.to),
      storage.users.getUser(userId),
    ]);
    res.json(calculateExerciseAnalytics(allSets, { weightUnit: user?.weightUnit, distanceUnit: user?.distanceUnit }));
  }));

// Race Predictor — predicted HYROX finish time from the athlete's logged
// history. No aiConsentCheck: the endpoint degrades gracefully to a
// deterministic estimate when AI is disabled/unconsented/over budget, and only
// calls the model when consent + budget allow (handled inside the service).
//
// Stored-first: returns the LAST persisted prediction instantly (no AI spend)
// so the tab paints on open without a spinner, flagging `stale` when a workout
// was logged after it was generated. `?refresh=1` (manual refresh button) — or
// the absence of any stored row — regenerates and persists a fresh prediction.
router.get("/api/v1/race-prediction", isAuthenticated, rateLimiter("race-prediction", 12), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const refresh = req.query.refresh === "1";
    if (!refresh) {
      // Fetch the stored row and the staleness anchor concurrently — they read
      // unrelated tables (analytics_results vs workout_logs) so there's no
      // reason to pay two sequential DB round-trips on this "paint instantly on
      // tab open" path. Firing both unconditionally costs one harmless unused
      // query on the (rare) no-stored-row-yet branch below, in exchange for
      // halving the latency on every returning user's request.
      const [row, anchor] = await Promise.all([
        storage.analyticsResults.get(userId, "race_prediction"),
        getWorkoutAnchor(userId),
      ]);
      if (row) {
        res.json({
          ...(row.payload as RacePredictionResponse),
          generatedAt: row.generatedAt.toISOString(),
          stale: computeStale(row, anchor),
        });
        return;
      }
    }
    const prediction = await regenerateAndStoreRacePrediction(userId, reqLogger(req));
    res.json({ ...prediction, stale: false });
  }));

// Workout-logs cache — same coalescing pattern as above, namespaced with a
// `wl-` prefix so the shared `createCoalescedCache` helper can stay generic.
export const _workoutLogCacheForTesting = new Map<string, CacheEntry<WorkoutLog[]>>();
const getWorkoutLogsCoalesced = createCoalescedCache(
  _workoutLogCacheForTesting,
  "wl-",
  (userId, from, to) => storage.analytics.getWorkoutLogsByDateRange(userId, from, to),
);

router.get("/api/v1/training-overview", isAuthenticated, rateLimiter("analytics", 20), asyncHandler(async (req: DateReq, res: Response) => {
    const userId = getUserId(req);
    const dates = parseDateParams(req, res);
    if (!dates) return;

    // Delegate to the shared assembly, injecting the route's request-coalescing
    // caches so rapid tab refetches still collapse to a single storage call.
    res.json(
      await assembleTrainingOverview(userId, dates.from, dates.to, {
        workoutLogs: getWorkoutLogsCoalesced,
        exerciseSets: getExerciseSetsCoalesced,
      }),
    );
  }));


router.get("/api/v1/analytics/internal/structured-exercise-health", isAuthenticated, rateLimiter("internalAnalytics", 5), requireInternalAnalyticsSecret, asyncHandler(async (_req, res) => {
  const rollups = await db.execute<{ day: string; total_rows: number; structured_rows: number; legacy_only_rows: number; failed_hydration_backlog: number; legacy_only_pct: number }>(sql`
    select day, total_rows, structured_rows, legacy_only_rows, failed_hydration_backlog, legacy_only_pct
    from structured_exercise_health_daily_rollups
    where day >= (current_date - interval '30 days')
    order by day desc
  `);
  const counters = await db.execute<{ day: string; owner_type: string; source: string; counter_name: string; value: number }>(sql`
    select day, owner_type, source, counter_name, value
    from structured_exercise_health_counters
    where day = current_date
    order by owner_type, source, counter_name
  `);
  res.json({ rollups: rollups.rows, counters: counters.rows });
}));

export default router;

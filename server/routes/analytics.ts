import crypto from "node:crypto";

import { dateStringSchema, type RacePredictionResponse, type WorkoutLog } from "@shared/schema";
import { sql } from "drizzle-orm";
import { type NextFunction, type Request as ExpressRequest, type Response,Router } from "express";

import { isAuthenticated } from "../clerkAuth";
import { ANALYTICS_CACHE_TTL_MS } from "../constants";
import { db } from "../db";
import { env } from "../env";
import { reqLogger } from "../logger";
import { asyncHandler, rateLimiter } from "../routeUtils";
import { computeStale, getLatestWorkoutDate, regenerateAndStoreRacePrediction } from "../services/analyticsPersistence";
import { calculateExerciseAnalytics, calculatePersonalRecords, calculateTrainingOverview, type ExerciseSetWithDate } from "../services/analyticsService";
import { storage } from "../storage";
import type { SlimLoggedExerciseSet } from "../storage/shared";
import { getUserId } from "../types";

const router = Router();

const CACHE_TTL_MS = ANALYTICS_CACHE_TTL_MS;
const MAX_CACHE_SIZE = 500;

function evictStale<T extends { timestamp: number }>(map: Map<string, T>, ttl: number, maxSize: number): void {
  const now = Date.now();
  // First pass: remove expired entries
  for (const [key, entry] of map) {
    if (now - entry.timestamp >= ttl) map.delete(key);
  }
  // Second pass: if still over limit, drop oldest
  while (map.size > maxSize) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of map) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }
    if (oldestKey) map.delete(oldestKey);
    else break;
  }
}

interface CacheEntry<T> {
  promise: Promise<T>;
  timestamp: number;
}

/**
 * In-memory request coalescing + TTL cache used for the analytics routes.
 * Collapses concurrent requests for the same (userId, from, to) into a
 * single storage call and caches the result for up to `CACHE_TTL_MS` to
 * absorb rapid refetches from the Analytics tabs. On fetch failure the
 * entry is evicted so the next request retries immediately.
 */
function createCoalescedCache<T>(
  cache: Map<string, CacheEntry<T>>,
  keyPrefix: string,
  fetcher: (userId: string, from?: string, to?: string) => Promise<T>,
): (userId: string, from?: string, to?: string) => Promise<T> {
  return (userId, from, to) => {
    const cacheKey = `${keyPrefix}${userId}-${from ?? 'none'}-${to ?? 'none'}`;
    const now = Date.now();

    const entry = cache.get(cacheKey);
    if (entry && now - entry.timestamp < CACHE_TTL_MS) {
      return entry.promise;
    }

    const promise = fetcher(userId, from, to).catch((error: unknown) => {
      cache.delete(cacheKey);
      throw error;
    });
    cache.set(cacheKey, { promise, timestamp: now });
    evictStale(cache, CACHE_TTL_MS, MAX_CACHE_SIZE);
    return promise;
  };
}

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

export function todayUtcYyyyMmDd(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .split("T")[0];
}

export function addCalendarDays(date: string, delta: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().split("T")[0];
}

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

router.get("/api/v1/personal-records", isAuthenticated, rateLimiter("analytics", 20), asyncHandler(async (req: DateReq, res: Response) => {
    const userId = getUserId(req);
    const dates = parseDateParams(req, res);
    if (!dates) return;

    const prSets = await getPersonalRecordSetsCoalesced(userId, dates.from, dates.to);
    res.json(calculatePersonalRecords(prSets));
  }));

router.get("/api/v1/exercise-analytics", isAuthenticated, rateLimiter("analytics", 20), asyncHandler(async (req: DateReq, res: Response) => {
    const userId = getUserId(req);
    const dates = parseDateParams(req, res);
    if (!dates) return;

    const allSets = await getExerciseSetsCoalesced(userId, dates.from, dates.to);
    res.json(calculateExerciseAnalytics(allSets));
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
      const row = await storage.analyticsResults.get(userId, "race_prediction");
      if (row) {
        const latestWorkoutDate = await getLatestWorkoutDate(userId);
        res.json({
          ...(row.payload as RacePredictionResponse),
          generatedAt: row.generatedAt.toISOString(),
          stale: computeStale(row, latestWorkoutDate),
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

/**
 * Returns the pair of ISO dates that bound the period immediately BEFORE
 * [from, to], with the same length. Returns null when we can't derive a
 * meaningful previous window (e.g. the user picked "all time" so there's
 * no lower bound to anchor the comparison).
 */
function computePreviousWindow(from?: string, to?: string): { from: string; to: string } | null {
  if (!from) return null;
  const fromDate = new Date(`${from}T00:00:00Z`);
  // When `to` is absent (the common ?from=... flow), anchor the current
  // window's upper bound at midnight UTC of today. Using `new Date()` with
  // a wall-clock time component would make (to - from) include fractional
  // days, and after truncating to YYYY-MM-DD the previous window would end
  // up one day longer for most of the calendar day — skewing all delta
  // percentages.
  let toDate: Date;
  if (to) {
    toDate = new Date(`${to}T00:00:00Z`);
  } else {
    const now = new Date();
    toDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return null;
  if (toDate < fromDate) return null;

  const dayMs = 24 * 60 * 60 * 1000;
  // Previous window ends the day before the current window starts and has
  // the same inclusive length. For an inclusive range [from, to] with N
  // days, (to - from) is (N-1) day-spans — which is exactly the offset we
  // need to step back from previousTo to previousFrom.
  const previousTo = new Date(fromDate.getTime() - dayMs);
  const previousFrom = new Date(previousTo.getTime() - (toDate.getTime() - fromDate.getTime()));

  return {
    from: previousFrom.toISOString().split("T")[0],
    to: previousTo.toISOString().split("T")[0],
  };
}

router.get("/api/v1/training-overview", isAuthenticated, rateLimiter("analytics", 20), asyncHandler(async (req: DateReq, res: Response) => {
    const userId = getUserId(req);
    const dates = parseDateParams(req, res);
    if (!dates) return;

    const previousWindow = computePreviousWindow(dates.from, dates.to);
    const loadCurrentDate = dates.to ?? todayUtcYyyyMmDd();
    const loadHistoryStart = addCalendarDays(loadCurrentDate, -70);

    const [
      workoutLogs,
      allSets,
      previousWorkoutLogs,
      user,
      loadTags,
      loadWorkoutLogs,
      loadExerciseSets,
    ] = await Promise.all([
      getWorkoutLogsCoalesced(userId, dates.from, dates.to),
      getExerciseSetsCoalesced(userId, dates.from, dates.to),
      previousWindow
        ? getWorkoutLogsCoalesced(userId, previousWindow.from, previousWindow.to)
        : Promise.resolve(undefined),
      storage.users.getUser(userId),
      storage.analytics.getExerciseLoadTags(),
      getWorkoutLogsCoalesced(userId, loadHistoryStart, loadCurrentDate),
      getExerciseSetsCoalesced(userId, loadHistoryStart, loadCurrentDate),
    ]);

    res.json(calculateTrainingOverview(
      workoutLogs,
      allSets,
      previousWorkoutLogs,
      user?.weeklyGoal ?? 5,
      loadTags,
      {
        workoutLogs: loadWorkoutLogs,
        exerciseSets: loadExerciseSets,
        currentDate: loadCurrentDate,
      },
      user?.userTimezone,
      user?.weightUnit ?? "kg",
      {
        age: user?.age ?? null,
        gender: user?.gender ?? null,
        restingHr: user?.restingHr ?? null,
        maxHr: user?.maxHr ?? null,
        ftp: user?.ftp ?? null,
      },
    ));
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

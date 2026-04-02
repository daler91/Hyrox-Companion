import { Router, type Request as ExpressRequest, type Response } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { calculatePersonalRecords, calculateExerciseAnalytics, calculateTrainingOverview, type ExerciseSetWithDate } from "../services/analyticsService";
import type { WorkoutLog } from "@shared/schema";
import { getUserId } from "../types";
import { rateLimiter, asyncHandler } from "../routeUtils";
import { dateStringSchema } from "@shared/schema";
import { ANALYTICS_CACHE_TTL_MS } from "../constants";

const router = Router();

const CACHE_TTL_MS = ANALYTICS_CACHE_TTL_MS;

interface CacheEntry {
  promise: Promise<ExerciseSetWithDate[]>;
  timestamp: number;
}

// Store pending promises and cached results to prevent redundant DB queries
// for both concurrent and sequential requests within the TTL window.
export const _cacheForTesting = new Map<string, CacheEntry>();
const cache = _cacheForTesting;

function getExerciseSetsCoalesced(userId: string, from?: string, to?: string): Promise<ExerciseSetWithDate[]> {
  const cacheKey = `${userId}-${from || 'none'}-${to || 'none'}`;
  const now = Date.now();

  const entry = cache.get(cacheKey);
  if (entry && (now - entry.timestamp < CACHE_TTL_MS)) {
    return entry.promise;
  }

  // If expired or missing, fetch from storage
  const promise = storage.getAllExerciseSetsWithDates(userId, from, to)
    .catch((error) => {
      // Remove from cache on failure so subsequent requests retry immediately
      cache.delete(cacheKey);
      throw error;
    });

  cache.set(cacheKey, { promise, timestamp: now });
  return promise;
}

export function validDate(val: unknown): string | undefined {
  if (!val) return undefined;
  const parsed = dateStringSchema.safeParse(val);
  return parsed.success ? parsed.data : undefined;
}

type DateQuery = { from?: string; to?: string };
type DateReq = ExpressRequest<Record<string, never>, unknown, unknown, DateQuery>;

function parseDateParams(req: DateReq, res: Response): { from?: string; to?: string } | null {
  const from = validDate(req.query.from);
  const to = validDate(req.query.to);

  if (req.query.from && !from) {
    res.status(400).json({ error: "Invalid 'from' date format", code: "BAD_REQUEST" });
    return null;
  }
  if (req.query.to && !to) {
    res.status(400).json({ error: "Invalid 'to' date format", code: "BAD_REQUEST" });
    return null;
  }
  return { from, to };
}

router.get("/api/v1/personal-records", isAuthenticated, rateLimiter("analytics", 20), asyncHandler(async (req: DateReq, res: Response) => {
    const userId = getUserId(req);
    const dates = parseDateParams(req, res);
    if (!dates) return;

    const allSets = await getExerciseSetsCoalesced(userId, dates.from, dates.to);
    res.json(calculatePersonalRecords(allSets));
  }));

router.get("/api/v1/exercise-analytics", isAuthenticated, rateLimiter("analytics", 20), asyncHandler(async (req: DateReq, res: Response) => {
    const userId = getUserId(req);
    const dates = parseDateParams(req, res);
    if (!dates) return;

    const allSets = await getExerciseSetsCoalesced(userId, dates.from, dates.to);
    res.json(calculateExerciseAnalytics(allSets));
  }));

// Workout logs cache for training overview
interface WorkoutLogCacheEntry {
  promise: Promise<WorkoutLog[]>;
  timestamp: number;
}

export const _workoutLogCacheForTesting = new Map<string, WorkoutLogCacheEntry>();
const workoutLogCache = _workoutLogCacheForTesting;

function getWorkoutLogsCoalesced(userId: string, from?: string, to?: string): Promise<WorkoutLog[]> {
  const cacheKey = `wl-${userId}-${from || 'none'}-${to || 'none'}`;
  const now = Date.now();

  const entry = workoutLogCache.get(cacheKey);
  if (entry && (now - entry.timestamp < CACHE_TTL_MS)) {
    return entry.promise;
  }

  const promise = storage.getWorkoutLogsByDateRange(userId, from, to)
    .catch((error) => {
      workoutLogCache.delete(cacheKey);
      throw error;
    });

  workoutLogCache.set(cacheKey, { promise, timestamp: now });
  return promise;
}

router.get("/api/v1/training-overview", isAuthenticated, rateLimiter("analytics", 20), asyncHandler(async (req: DateReq, res: Response) => {
    const userId = getUserId(req);
    const dates = parseDateParams(req, res);
    if (!dates) return;

    const [workoutLogs, allSets] = await Promise.all([
      getWorkoutLogsCoalesced(userId, dates.from, dates.to),
      getExerciseSetsCoalesced(userId, dates.from, dates.to),
    ]);

    res.json(calculateTrainingOverview(workoutLogs, allSets));
  }));

export default router;

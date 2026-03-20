import { logger } from "../logger";
import { Router, type Request as ExpressRequest, type Response } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { calculatePersonalRecords, calculateExerciseAnalytics, type ExerciseSetWithDate } from "../services/analyticsService";
import { getUserId } from "../types";
import { dateStringSchema } from "@shared/schema";

const router = Router();

// Cache TTL in milliseconds (5 minutes)
const CACHE_TTL_MS = 5 * 60 * 1000;

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

router.get("/api/v1/personal-records", isAuthenticated, async (req: ExpressRequest<{}, any, any, { from?: string; to?: string }>, res: Response) => {
  try {
    const userId = getUserId(req);
    const from = validDate(req.query.from);
    const to = validDate(req.query.to);

    if (req.query.from && !from) return res.status(400).json({ error: "Invalid 'from' date format" });
    if (req.query.to && !to) return res.status(400).json({ error: "Invalid 'to' date format" });
    const allSets = await getExerciseSetsCoalesced(userId, from, to);
    res.json(calculatePersonalRecords(allSets));
  } catch (error) {
    logger.error({ err: error }, "Error fetching PRs:");
    res.status(500).json({ error: "Failed to fetch personal records" });
  }
});

router.get("/api/v1/exercise-analytics", isAuthenticated, async (req: ExpressRequest<{}, any, any, { from?: string; to?: string }>, res: Response) => {
  try {
    const userId = getUserId(req);
    const from = validDate(req.query.from);
    const to = validDate(req.query.to);

    if (req.query.from && !from) return res.status(400).json({ error: "Invalid 'from' date format" });
    if (req.query.to && !to) return res.status(400).json({ error: "Invalid 'to' date format" });

    const allSets = await getExerciseSetsCoalesced(userId, from, to);
    res.json(calculateExerciseAnalytics(allSets));
  } catch (error) {
    logger.error({ err: error }, "Error fetching exercise analytics:");
    res.status(500).json({ error: "Failed to fetch exercise analytics" });
  }
});

export default router;

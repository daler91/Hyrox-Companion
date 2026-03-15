import { Router } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { calculatePersonalRecords, calculateExerciseAnalytics } from "../services/analyticsService";
import { getUserId, AuthenticatedRequest } from "../types";
import { dateStringSchema } from "@shared/schema";
import { ExerciseSet } from "@shared/schema";


const router = Router();

// Store pending promises to prevent redundant DB queries for concurrent requests
const pendingRequests = new Map<string, Promise<(ExerciseSet & { date: string })[]>>();

function getExerciseSetsCoalesced(userId: string, from?: string, to?: string): Promise<(ExerciseSet & { date: string })[]> {
  const cacheKey = `${userId}-${from || 'none'}-${to || 'none'}`;

  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey)!;
  }

  const promise = storage.getAllExerciseSetsWithDates(userId, from, to)
    .finally(() => {
      // Remove from map once the query finishes (success or failure)
      // to allow future requests to fetch fresh data
      pendingRequests.delete(cacheKey);
    });

  pendingRequests.set(cacheKey, promise);
  return promise;
}


function validDate(val: unknown): string | undefined {
  if (!val) return undefined;
  const parsed = dateStringSchema.safeParse(val);
  return parsed.success ? parsed.data : undefined;
}

router.get("/api/personal-records", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const from = validDate(req.query.from);
    const to = validDate(req.query.to);

    if (req.query.from && !from) return res.status(400).json({ error: "Invalid 'from' date format" });
    if (req.query.to && !to) return res.status(400).json({ error: "Invalid 'to' date format" });
    const allSets = await getExerciseSetsCoalesced(userId, from, to);
    res.json(calculatePersonalRecords(allSets));
  } catch (error) {
    console.error("Error fetching PRs:", error);
    res.status(500).json({ error: "Failed to fetch personal records" });
  }
});

router.get("/api/exercise-analytics", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const from = validDate(req.query.from);
    const to = validDate(req.query.to);

    if (req.query.from && !from) return res.status(400).json({ error: "Invalid 'from' date format" });
    if (req.query.to && !to) return res.status(400).json({ error: "Invalid 'to' date format" });

    const allSets = await getExerciseSetsCoalesced(userId, from, to);
    res.json(calculateExerciseAnalytics(allSets));
  } catch (error) {
    console.error("Error fetching exercise analytics:", error);
    res.status(500).json({ error: "Failed to fetch exercise analytics" });
  }
});

export default router;

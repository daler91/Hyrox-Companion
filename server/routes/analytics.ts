import { Router } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { calculatePersonalRecords, calculateExerciseAnalytics } from "../services/analyticsService";
import { AuthenticatedRequest } from "../types";
import { dateStringSchema, ExerciseSet } from "@shared/schema";
import { withAuth } from "../routeUtils";


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

router.get("/api/personal-records", isAuthenticated, withAuth(async (req, res, userId) => {
    const from = validDate(req.query.from);
    const to = validDate(req.query.to);

    if (req.query.from && !from) return res.status(400).json({ error: "Invalid 'from' date format" });
    if (req.query.to && !to) return res.status(400).json({ error: "Invalid 'to' date format" });
    const allSets = await getExerciseSetsCoalesced(userId, from, to);
    res.json(calculatePersonalRecords(allSets));
  }, "Error fetching PRs:", "Failed to fetch personal records"));

router.get("/api/exercise-analytics", isAuthenticated, withAuth(async (req, res, userId) => {
    const from = validDate(req.query.from);
    const to = validDate(req.query.to);

    if (req.query.from && !from) return res.status(400).json({ error: "Invalid 'from' date format" });
    if (req.query.to && !to) return res.status(400).json({ error: "Invalid 'to' date format" });

    const allSets = await getExerciseSetsCoalesced(userId, from, to);
    res.json(calculateExerciseAnalytics(allSets));
  }, "Error fetching exercise analytics:", "Failed to fetch exercise analytics"));

export default router;

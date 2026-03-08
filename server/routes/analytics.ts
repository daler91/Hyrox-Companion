import { Router } from "express";
import { isAuthenticated } from "../replitAuth";
import { storage } from "../storage";
import { calculatePersonalRecords, calculateExerciseAnalytics } from "../services/analyticsService";
import { getUserId } from "../types";

const router = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(val: unknown): string | undefined {
  if (typeof val !== "string") return undefined;
  return DATE_RE.test(val) ? val : undefined;
}

router.get("/api/personal-records", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const from = validDate(req.query.from);
    const to = validDate(req.query.to);
    const allSets = await storage.getAllExerciseSetsWithDates(userId, from, to);
    res.json(calculatePersonalRecords(allSets));
  } catch (error) {
    console.error("Error fetching PRs:", error);
    res.status(500).json({ error: "Failed to fetch personal records" });
  }
});

router.get("/api/exercise-analytics", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const from = validDate(req.query.from);
    const to = validDate(req.query.to);
    const allSets = await storage.getAllExerciseSetsWithDates(userId, from, to);
    res.json(calculateExerciseAnalytics(allSets));
  } catch (error) {
    console.error("Error fetching exercise analytics:", error);
    res.status(500).json({ error: "Failed to fetch exercise analytics" });
  }
});

export default router;

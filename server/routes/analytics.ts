import { Router } from "express";
import { isAuthenticated } from "../replitAuth";
import { storage } from "../storage";
import { calculatePersonalRecords, calculateExerciseAnalytics } from "../services/analyticsService";
import { getUserId } from "../types";

const router = Router();

router.get("/api/personal-records", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const allSets = await storage.getAllExerciseSetsWithDates(userId);
    res.json(calculatePersonalRecords(allSets));
  } catch (error) {
    console.error("Error fetching PRs:", error);
    res.status(500).json({ error: "Failed to fetch personal records" });
  }
});

router.get("/api/exercise-analytics", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const allSets = await storage.getAllExerciseSetsWithDates(userId);
    res.json(calculateExerciseAnalytics(allSets));
  } catch (error) {
    console.error("Error fetching exercise analytics:", error);
    res.status(500).json({ error: "Failed to fetch exercise analytics" });
  }
});

export default router;

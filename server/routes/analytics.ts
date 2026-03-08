import { Router } from "express";
import { isAuthenticated } from "../replitAuth";
import { storage } from "../storage";

const router = Router();

router.get("/api/personal-records", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
    const allSets = await storage.getAllExerciseSetsWithDates(userId);

    const prs: Record<string, { category: string; customLabel?: string | null; maxWeight?: { value: number; date: string; workoutLogId: string }; maxDistance?: { value: number; date: string; workoutLogId: string }; bestTime?: { value: number; date: string; workoutLogId: string } }> = {};

    for (const set of allSets) {
      const prKey = set.exerciseName === "custom" && set.customLabel
        ? `custom:${set.customLabel}`
        : set.exerciseName;
      if (!prs[prKey]) prs[prKey] = { category: set.category, customLabel: set.customLabel };
      const pr = prs[prKey];
      if (set.weight && (!pr.maxWeight || set.weight > pr.maxWeight.value)) {
        pr.maxWeight = { value: set.weight, date: set.date, workoutLogId: set.workoutLogId };
      }
      if (set.distance && (!pr.maxDistance || set.distance > pr.maxDistance.value)) {
        pr.maxDistance = { value: set.distance, date: set.date, workoutLogId: set.workoutLogId };
      }
      if (set.time && set.time > 0 && (!pr.bestTime || set.time < pr.bestTime.value)) {
        pr.bestTime = { value: set.time, date: set.date, workoutLogId: set.workoutLogId };
      }
    }

    res.json(prs);
  } catch (error) {
    console.error("Error fetching PRs:", error);
    res.status(500).json({ error: "Failed to fetch personal records" });
  }
});

router.get("/api/exercise-analytics", isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
    const allSets = await storage.getAllExerciseSetsWithDates(userId);

    const byExercise: Record<string, Array<{ date: string; workoutLogId: string; setNumber: number; reps?: number | null; weight?: number | null; distance?: number | null; time?: number | null }>> = {};

    for (const set of allSets) {
      const exerciseKey = set.exerciseName === "custom" && set.customLabel
        ? `custom:${set.customLabel}`
        : set.exerciseName;
      if (!byExercise[exerciseKey]) byExercise[exerciseKey] = [];
      byExercise[exerciseKey].push({
        date: set.date,
        workoutLogId: set.workoutLogId,
        setNumber: set.setNumber,
        reps: set.reps,
        weight: set.weight,
        distance: set.distance,
        time: set.time,
      });
    }

    const analytics: Record<string, Array<{ date: string; totalVolume: number; maxWeight: number; totalSets: number; totalReps: number; totalDistance: number }>> = {};

    for (const [exercise, sets] of Object.entries(byExercise)) {
      const byDate: Record<string, typeof sets> = {};
      for (const s of sets) {
        if (!byDate[s.date]) byDate[s.date] = [];
        byDate[s.date].push(s);
      }

      analytics[exercise] = Object.entries(byDate)
        .map(([date, daySets]) => {
          let totalVolume = 0;
          let maxWeight = 0;
          let totalReps = 0;
          let totalDistance = 0;
          for (const s of daySets) {
            if (s.weight && s.reps) totalVolume += s.weight * s.reps;
            if (s.weight && s.weight > maxWeight) maxWeight = s.weight;
            if (s.reps) totalReps += s.reps;
            if (s.distance) totalDistance += s.distance;
          }
          return { date, totalVolume, maxWeight, totalSets: daySets.length, totalReps, totalDistance };
        })
        .sort((a, b) => a.date.localeCompare(b.date));
    }

    res.json(analytics);
  } catch (error) {
    console.error("Error fetching exercise analytics:", error);
    res.status(500).json({ error: "Failed to fetch exercise analytics" });
  }
});

export default router;

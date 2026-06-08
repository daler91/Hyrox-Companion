import { storage } from "../../storage";
import { calculateTrainingLoad } from "../trainingLoadService";
import type { DailyUtss } from "./blockView";

/**
 * Fetch a user's per-day training load (UTSS) over `[from, to]` inclusive: the
 * workout-log / exercise-set / load-tag reads plus the load calculation. Shared
 * single source for the daily-summary, block-view, and fuelling-range routes so
 * the analytics fetch + load call lives in exactly one place.
 */
export async function fetchDailyUtss(
  userId: string,
  from: string,
  to: string,
): Promise<DailyUtss[]> {
  const [workoutLogs, exerciseSets, loadTags] = await Promise.all([
    storage.analytics.getWorkoutLogsByDateRange(userId, from, to),
    storage.analytics.getAllExerciseSetsWithDates(userId, from, to),
    storage.analytics.getExerciseLoadTags(),
  ]);
  return calculateTrainingLoad(workoutLogs, exerciseSets, loadTags, { currentDate: to }).dailyLoads;
}

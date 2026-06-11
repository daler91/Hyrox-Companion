import type { WorkoutLog } from "@shared/schema";

import { storage } from "../../storage";
import { calculateTrainingLoad } from "../trainingLoadService";
import type { DailyUtss } from "./blockView";

/**
 * Fetch a user's per-day training load (UTSS) over `[from, to]` inclusive plus
 * the raw workout logs the calculation read. Shared single source for the
 * daily-summary, block-view, and fuelling-range routes so the analytics fetch +
 * load call lives in exactly one place. The logs ride along for callers that
 * also need per-day outcomes (RPE/compliance) without a second fetch.
 */
export async function fetchDailyTraining(
  userId: string,
  from: string,
  to: string,
): Promise<{ dailyLoads: DailyUtss[]; workoutLogs: WorkoutLog[] }> {
  const [workoutLogs, exerciseSets, loadTags] = await Promise.all([
    storage.analytics.getWorkoutLogsByDateRange(userId, from, to),
    storage.analytics.getAllExerciseSetsWithDates(userId, from, to),
    storage.analytics.getExerciseLoadTags(),
  ]);
  return {
    dailyLoads: calculateTrainingLoad(workoutLogs, exerciseSets, loadTags, { currentDate: to })
      .dailyLoads,
    workoutLogs,
  };
}

/** Per-day UTSS only — see fetchDailyTraining. */
export async function fetchDailyUtss(
  userId: string,
  from: string,
  to: string,
): Promise<DailyUtss[]> {
  return (await fetchDailyTraining(userId, from, to)).dailyLoads;
}

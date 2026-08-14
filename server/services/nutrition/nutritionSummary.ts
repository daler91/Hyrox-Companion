/**
 * Shared nutrition aggregation for AI context (Phase 1 of the nutrition↔training
 * integration). Gathers the athlete's recent fuelling (intake) and joins it to
 * training load (UTSS) + targets + today's micronutrients into one compact,
 * structured summary.
 *
 * Consumed by both the nutrition-insights prompt
 * (./nutritionInsightsService.ts) and the coach / auto-suggestions context
 * (../ai/nutritionContext.ts), so the two features describe fuelling
 * identically. Data-only: no AI calls and no prompt strings live here — each
 * consumer owns its own formatting and inclusion policy.
 */
import type { BlockViewPoint } from "@shared/schema";

import { storage } from "../../storage";
import { getLocalDateStr } from "../../timezone";
import { calculateTrainingLoad } from "../trainingLoadService";
import { buildBlockView } from "./blockView";
import { buildMicroSummary } from "./micros";

export const NUTRITION_SUMMARY_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface NutritionTargetSummary {
  calories: number | null;
  proteinG: number | null;
  carbG: number | null;
  fatG: number | null;
}

export interface NutritionHighLoadDay {
  date: string;
  utss: number;
  calories: number;
  protein: number;
}

export interface NutritionLowMicro {
  label: string;
  pctRdi: number;
}

export interface NutritionSummary {
  windowDays: number;
  from: string;
  to: string;
  /** Days in the window with any food logged. */
  loggedDaysCount: number;
  /** Averages across logged days only (0 when nothing logged). */
  avgLoggedDay: { calories: number; protein: number; carb: number; fat: number };
  /** Current daily target effective on `to`, or null when none is set. */
  target: NutritionTargetSummary | null;
  /** Up to 5 highest training-load days in the window, with that day's intake. */
  highLoadDays: NutritionHighLoadDay[];
  /** Whether any training load was recorded in the window. */
  hasTrainingLoad: boolean;
  /** Micronutrient coverage for today's logged foods. */
  microStatus: "no_data" | "all_ok" | "low";
  /** Today's tracked micros below 50% of reference intake (empty unless `low`). */
  lowMicros: NutritionLowMicro[];
}

function average(points: BlockViewPoint[], select: (p: BlockViewPoint) => number): number {
  if (points.length === 0) return 0;
  return Math.round(points.reduce((sum, p) => sum + select(p), 0) / points.length);
}

async function getUserTimezone(userId: string): Promise<string> {
  const user = await storage.users.getUser(userId);
  return user?.userTimezone ?? "UTC";
}

/**
 * Build the structured nutrition summary over the last
 * `NUTRITION_SUMMARY_WINDOW_DAYS` (user-local) days. Mirrors the aggregates the
 * block view and micro panel use, so the coach and the insights panel agree.
 */
export async function buildNutritionSummary(userId: string): Promise<NutritionSummary> {
  const tz = await getUserTimezone(userId);
  const to = getLocalDateStr(new Date(), tz);
  const from = getLocalDateStr(
    new Date(Date.now() - (NUTRITION_SUMMARY_WINDOW_DAYS - 1) * DAY_MS),
    tz,
  );

  const [rows, workoutLogs, exerciseSets, loadTags, target, todayRows, user] = await Promise.all([
    storage.nutrition.listEntriesWithFoodForDateRange(userId, from, to),
    storage.analytics.getWorkoutLogsByDateRange(userId, from, to),
    storage.analytics.getAllExerciseSetsWithDates(userId, from, to),
    storage.analytics.getExerciseLoadTags(),
    storage.nutrition.getCurrentTarget(userId, to),
    storage.nutrition.listEntriesWithFoodForDate(userId, to),
    storage.users.getUser(userId),
  ]);

  const { dailyLoads } = calculateTrainingLoad(workoutLogs, exerciseSets, loadTags, {
    currentDate: to,
    weightUnit: user?.weightUnit || "kg",
    athlete: {
      age: user?.age ?? null,
      gender: user?.gender ?? null,
      restingHr: user?.restingHr ?? null,
      maxHr: user?.maxHr ?? null,
      ftp: user?.ftp ?? null,
    },
  });
  const points = buildBlockView(rows, dailyLoads, { from, to });
  const loggedDays = points.filter((p) => p.calories > 0);
  const highLoadDays = points
    .filter((p) => p.utss > 0)
    .sort((a, b) => b.utss - a.utss)
    .slice(0, 5)
    .map((p) => ({ date: p.date, utss: p.utss, calories: p.calories, protein: p.protein }));

  const micros = buildMicroSummary(todayRows);
  const lowMicros = micros
    .filter((m) => m.pctRdi < 50)
    .map((m) => ({ label: m.label, pctRdi: m.pctRdi }));
  let microStatus: NutritionSummary["microStatus"] = "all_ok";
  if (micros.length === 0) microStatus = "no_data";
  else if (lowMicros.length > 0) microStatus = "low";

  return {
    windowDays: NUTRITION_SUMMARY_WINDOW_DAYS,
    from,
    to,
    loggedDaysCount: loggedDays.length,
    avgLoggedDay: {
      calories: average(loggedDays, (p) => p.calories),
      protein: average(loggedDays, (p) => p.protein),
      carb: average(loggedDays, (p) => p.carb),
      fat: average(loggedDays, (p) => p.fat),
    },
    target: target
      ? {
          calories: target.calories ?? null,
          proteinG: target.proteinG ?? null,
          carbG: target.carbG ?? null,
          fatG: target.fatG ?? null,
        }
      : null,
    highLoadDays,
    hasTrainingLoad: highLoadDays.length > 0,
    microStatus,
    lowMicros,
  };
}

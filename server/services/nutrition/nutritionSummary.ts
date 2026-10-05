/**
 * Shared nutrition aggregation for AI context (Phase 1 of the nutrition↔training
 * integration). Gathers the athlete's recent fuelling (intake) and joins it to
 * training load (UTSS) + targets + micronutrients into one compact,
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
import type { LogEntryWithFood } from "./rollup";

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
  /**
   * The day the micros were judged on: the latest COMPLETE logged day (before
   * local today) in the window, or null when there is none.
   */
  microDate: string | null;
  /** Micronutrient coverage for `microDate`'s logged foods. */
  microStatus: "no_data" | "all_ok" | "low";
  /** `microDate`'s tracked micros below 50% of reference intake (empty unless `low`). */
  lowMicros: NutritionLowMicro[];
}

/**
 * The latest day before local `today` with food logged, or null. Micros were
 * judged on today alone, which the nightly recompute reads at local midnight
 * (empty, so every regenerated insight said "no micronutrient data") and a
 * mid-morning regenerate reads part-eaten (a breakfast against a full day's
 * reference intake, so the coach repeated false "low" flags). A finished day
 * is the earliest one whose totals mean anything. C8 (CODEBASE_ANALYSIS_2026-10-03)
 */
function latestCompleteLoggedDay(rows: LogEntryWithFood[], today: string): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    if (row.logDate < today && (latest == null || row.logDate > latest)) latest = row.logDate;
  }
  return latest;
}

/** Micronutrient coverage on the latest complete logged day (or none). */
function judgeMicros(
  rows: LogEntryWithFood[],
  today: string,
): Pick<NutritionSummary, "microDate" | "microStatus" | "lowMicros"> {
  const microDate = latestCompleteLoggedDay(rows, today);
  const micros =
    microDate == null ? [] : buildMicroSummary(rows.filter((r) => r.logDate === microDate));
  const lowMicros = micros
    .filter((m) => m.pctRdi < 50)
    .map((m) => ({ label: m.label, pctRdi: m.pctRdi }));
  let microStatus: NutritionSummary["microStatus"] = "all_ok";
  if (micros.length === 0) microStatus = "no_data";
  else if (lowMicros.length > 0) microStatus = "low";
  return { microDate, microStatus, lowMicros };
}

function average(points: BlockViewPoint[], select: (p: BlockViewPoint) => number): number {
  if (points.length === 0) return 0;
  return Math.round(points.reduce((sum, p) => sum + select(p), 0) / points.length);
}

/**
 * Build the structured nutrition summary over the last
 * `NUTRITION_SUMMARY_WINDOW_DAYS` (user-local) days. Mirrors the aggregates the
 * block view and micro panel use, so the coach and the insights panel agree.
 */
export async function buildNutritionSummary(userId: string): Promise<NutritionSummary> {
  // ⚡ Bolt Performance Optimization: `user` used to be fetched twice — once here
  // (via a since-removed getUserTimezone helper) to resolve the local "today", and
  // again inside the Promise.all below to read weightUnit/age/gender for the load
  // calc. Both reads return the identical `users` row for the same userId, so the
  // second one was a pure duplicate DB round-trip on every call. Fetching it once
  // up front (still required before `to`/`from` can be computed) and reusing it in
  // the batch drops this from 2 sequential+parallel `getUser` calls to 1.
  const user = await storage.users.getUser(userId);
  const tz = user?.userTimezone ?? "UTC";
  const to = getLocalDateStr(new Date(), tz);
  const from = getLocalDateStr(
    new Date(Date.now() - (NUTRITION_SUMMARY_WINDOW_DAYS - 1) * DAY_MS),
    tz,
  );

  const [rows, workoutLogs, exerciseSets, loadTags, target] = await Promise.all([
    storage.nutrition.listEntriesWithFoodForDateRange(userId, from, to),
    storage.analytics.getWorkoutLogsByDateRange(userId, from, to),
    storage.analytics.getAllExerciseSetsWithDates(userId, from, to),
    storage.analytics.getExerciseLoadTags(),
    storage.nutrition.getCurrentTarget(userId, to),
  ]);

  const { dailyLoads } = calculateTrainingLoad(workoutLogs, exerciseSets, loadTags, {
    currentDate: to,
    weightUnit: user?.weightUnit || "kg",
    distanceUnit: user?.distanceUnit || "km",
    athlete: {
      age: user?.age ?? null,
      gender: user?.gender ?? null,
      restingHr: user?.restingHr ?? null,
      // Scales unweighted-rep tonnage with the body being moved (audit M2).
      bodyweightKg: user?.bodyweightKg ?? null,
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
    ...judgeMicros(rows, to),
  };
}

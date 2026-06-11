import { effectiveTarget } from "@shared/nutritionTargets";
import type { BlockViewPoint, EffectiveTargetSummary, FuellingDayPoint, NutritionTarget } from "@shared/schema";

import { type DailyUtss, eachDate, toUtssByDate } from "./blockView";
import { groupByLogDate, type LogEntryWithFood, roundMacros, sumNutrition } from "./rollup";

/**
 * Resolve the target version effective on `date` — the latest one whose
 * effectiveFrom is on or before that day — from a list pre-sorted newest-first.
 * Mirrors storage.getCurrentTarget's rule, but in memory, so a whole range
 * resolves from a single history read. String compare is valid for YYYY-MM-DD.
 */
function baselineForDate(
  sortedNewestFirst: NutritionTarget[],
  date: string,
): NutritionTarget | null {
  for (const t of sortedNewestFirst) {
    if (t.effectiveFrom <= date) return t;
  }
  return null;
}

/**
 * Build a day's EffectiveTargetSummary from its baseline target + that day's
 * training load, reusing the shared `effectiveTarget` calculator. Shared with the
 * daily-summary route's resolver so a day's target is derived identically
 * everywhere. Pure; carbs/calories scale with load only when periodisation is on.
 */
export function buildEffectiveTargetSummary(
  baseline: NutritionTarget,
  dayUtss: number,
): EffectiveTargetSummary {
  const utss = baseline.periodizationEnabled ? dayUtss : 0;
  const result = effectiveTarget(
    {
      calories: baseline.calories,
      proteinG: baseline.proteinG,
      carbG: baseline.carbG,
      fatG: baseline.fatG,
    },
    utss,
    {
      enabled: baseline.periodizationEnabled,
      referenceUtss: baseline.referenceUtss ?? 0,
      carbGramsPerUtss: baseline.carbGramsPerUtss ?? 0,
    },
  );
  return {
    calories: result.calories,
    proteinG: result.proteinG,
    carbG: result.carbG,
    fatG: result.fatG,
    carbDeltaG: result.carbDeltaG,
    utss: Math.round(utss * 10) / 10,
    scaled: result.scaled,
  };
}

/** Minimal per-workout outcome slice for the correlation decoration. */
export interface DayOutcomeWorkout {
  date: string;
  rpe: number | null;
  compliancePct: number | null;
}

function meanOrNull(values: number[], round: (n: number) => number): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((acc, v) => acc + v, 0) / values.length);
}

/**
 * Roadmap G — decorate block-view points with the day's outcome fields for the
 * fuelling↔performance correlation: the effective carb target (same resolution
 * rules as the range/summary endpoints, fed by the RAW per-day UTSS so all
 * three surfaces derive the identical target — the point's own utss is
 * display-rounded) and the day's mean session RPE / prescription compliance
 * from its workout logs. Pure; fields are null on days with no target or no
 * recorded outcome.
 */
export function decorateBlockPointsWithOutcomes(
  points: BlockViewPoint[],
  workoutLogs: readonly DayOutcomeWorkout[],
  targets: NutritionTarget[],
  dailyLoads: ReadonlyArray<DailyUtss>,
): BlockViewPoint[] {
  const sortedTargets = [...targets].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  const utssByDate = toUtssByDate(dailyLoads);
  const logsByDate = new Map<string, DayOutcomeWorkout[]>();
  for (const log of workoutLogs) {
    const list = logsByDate.get(log.date) ?? [];
    list.push(log);
    logsByDate.set(log.date, list);
  }

  return points.map((point) => {
    const baseline = baselineForDate(sortedTargets, point.date);
    const dayLogs = logsByDate.get(point.date) ?? [];
    return {
      ...point,
      carbTargetG: baseline
        ? buildEffectiveTargetSummary(baseline, utssByDate.get(point.date) ?? 0).carbG
        : null,
      avgRpe: meanOrNull(
        dayLogs.map((l) => l.rpe).filter((r): r is number => r != null),
        (n) => Math.round(n * 10) / 10,
      ),
      compliancePct: meanOrNull(
        dayLogs.map((l) => l.compliancePct).filter((c): c is number => c != null),
        Math.round,
      ),
    };
  });
}

/**
 * Phase 2 (Timeline integration) — per-day fuelling progress for the home-screen
 * chips: each day's intake totals, the load-adjusted effective target (reusing
 * the same `effectiveTarget` calculator + UTSS source the daily summary and block
 * view use), and whether a post-workout meal was logged. Every day in
 * `[from, to]` gets a point (zero totals / null target where there's no data).
 * Pure and DB-free so the windowing + target-resolution rules are unit-testable.
 */
export function buildFuellingRange(
  rows: LogEntryWithFood[],
  dailyLoads: ReadonlyArray<DailyUtss>,
  targets: NutritionTarget[],
  range: { from: string; to: string },
): FuellingDayPoint[] {
  const rowsByDate = groupByLogDate(rows);
  const utssByDate = toUtssByDate(dailyLoads);

  // Newest effectiveFrom first, so the first match for a date is the version in
  // force on that date.
  const sortedTargets = [...targets].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));

  const points: FuellingDayPoint[] = [];
  for (const date of eachDate(range.from, range.to)) {
    const dayRows = rowsByDate.get(date) ?? [];
    const baseline = baselineForDate(sortedTargets, date);
    points.push({
      date,
      totals: roundMacros(sumNutrition(dayRows)),
      effectiveTarget: baseline
        ? buildEffectiveTargetSummary(baseline, utssByDate.get(date) ?? 0)
        : null,
      hasPostWorkoutFuel: dayRows.some((r) => r.mealType === "post_workout"),
    });
  }
  return points;
}

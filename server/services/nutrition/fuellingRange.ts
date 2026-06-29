import {
  effectiveTargetWindowed,
  type PeriodizationConfig,
  singleDayWindow,
  type TrainingLoadWindow,
} from "@shared/nutritionTargets";
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

/** Map a stored target row's periodisation columns to the calculator's config. */
export function periodizationConfigFromTarget(t: NutritionTarget): PeriodizationConfig {
  return {
    enabled: t.periodizationEnabled,
    referenceUtss: t.referenceUtss ?? 0,
    carbGramsPerUtss: t.carbGramsPerUtss ?? 0,
    recoveryEnabled: t.recoveryEnabled ?? false,
    recoveryProteinBumpFrac: t.recoveryProteinBumpFrac ?? undefined,
    preloadCarbGramsPerUtss: t.preloadCarbGramsPerUtss ?? undefined,
    preloadDaysAhead: t.preloadDaysAhead ?? undefined,
    phaseAware: t.phaseAware ?? false,
    maxCarbDeltaG: t.maxCarbDeltaG ?? undefined,
  };
}

/**
 * Build a day's EffectiveTargetSummary from its baseline target + a training-load
 * window, reusing the shared `effectiveTargetWindowed` calculator. Shared with the
 * daily-summary route's resolver so a day's target is derived identically
 * everywhere. The window carries today's load plus (for the daily view) recent
 * actual load and upcoming planned load; the block/range analytics views pass a
 * `singleDayWindow` so they stay load-correlation views. Pure; carbs/calories/
 * protein flex only when periodisation (and the matching knob) is on.
 */
export function buildEffectiveTargetSummary(
  baseline: NutritionTarget,
  window: TrainingLoadWindow,
): EffectiveTargetSummary {
  const result = effectiveTargetWindowed(
    {
      calories: baseline.calories,
      proteinG: baseline.proteinG,
      carbG: baseline.carbG,
      fatG: baseline.fatG,
    },
    window,
    periodizationConfigFromTarget(baseline),
  );
  return {
    calories: result.calories,
    proteinG: result.proteinG,
    carbG: result.carbG,
    fatG: result.fatG,
    carbDeltaG: result.carbDeltaG,
    baseLoadDeltaG: result.baseLoadDeltaG,
    recoveryDeltaG: result.recoveryDeltaG,
    preloadDeltaG: result.preloadDeltaG,
    proteinDeltaG: result.proteinDeltaG,
    utss: baseline.periodizationEnabled ? Math.round(window.dayUtss * 10) / 10 : 0,
    scaled: result.scaled,
    reasonCodes: result.reasonCodes,
    explanation: result.explanation,
    phase: window.phase,
  };
}

/** Minimal per-workout outcome slice for the correlation decoration. */
export interface DayOutcomeWorkout {
  date: string;
  rpe: number | null;
  compliancePct: number | null;
}

function meanOfProperty<T>(
  items: T[],
  selector: (item: T) => number | null | undefined,
  round: (n: number) => number,
): number | null {
  let sum = 0;
  let count = 0;
  for (const item of items) {
    const val = selector(item);
    if (val != null) {
      sum += val;
      count++;
    }
  }
  return count > 0 ? round(sum / count) : null;
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
        ? buildEffectiveTargetSummary(baseline, singleDayWindow(utssByDate.get(point.date) ?? 0)).carbG
        : null,
      avgRpe: meanOfProperty(dayLogs, (l) => l.rpe, (n) => Math.round(n * 10) / 10),
      compliancePct: meanOfProperty(dayLogs, (l) => l.compliancePct, Math.round),
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
        ? buildEffectiveTargetSummary(baseline, singleDayWindow(utssByDate.get(date) ?? 0))
        : null,
      hasPostWorkoutFuel: dayRows.some((r) => r.mealType === "post_workout"),
    });
  }
  return points;
}

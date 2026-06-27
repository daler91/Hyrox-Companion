import type {
  TrainingLoadOverview,
  TrainingLoadTrendPoint,
  TrainingOverview,
  WeeklySummary,
} from "@shared/schema";
import { describe, expect, it } from "vitest";

import { buildOverviewChartFacts } from "../overviewAnalysisService";

function trendPoint(overrides: Partial<TrainingLoadTrendPoint> = {}): TrainingLoadTrendPoint {
  return {
    date: "2026-06-01",
    utss: 0,
    acwr: null,
    zone: "insufficient_data",
    tsb: null,
    monotony: null,
    strain: null,
    hrTss: null,
    hrZone: null,
    tss: null,
    acuteEwma: null,
    chronicEwma: null,
    ...overrides,
  };
}

function trainingLoad(overrides: Partial<TrainingLoadOverview> = {}): TrainingLoadOverview {
  return {
    currentUtss: 0,
    acuteAvg: 0,
    chronicAvg: 0,
    acwr: null,
    zone: "insufficient_data",
    tsb: null,
    monotony: null,
    strain: null,
    monotonyZone: "ok",
    hrTss: null,
    hrZone: null,
    tss: null,
    hrZones: [],
    estimatedLthr: 0,
    powerTssEstimated: true,
    flaggedVectors: [],
    activeRestrictions: [],
    downshiftRationale: null,
    trend: [],
    ...overrides,
  };
}

function weekly(overrides: Partial<WeeklySummary> = {}): WeeklySummary {
  return {
    weekStart: "2026-06-01",
    workoutCount: 3,
    totalDuration: 180,
    avgRpe: 7,
    categoryBreakdown: {},
    ...overrides,
  };
}

function overview(overrides: Partial<TrainingOverview> = {}): TrainingOverview {
  return {
    weeklySummaries: [],
    workoutDates: [],
    categoryTotals: {},
    stationCoverage: [],
    movementPatternCoverage: [],
    muscleGroupCoverage: [],
    currentStreak: 0,
    weeklyCompletedWorkouts: 0,
    weeklyGoal: 5,
    currentStats: {
      totalWorkouts: 0,
      avgPerWeek: 0,
      totalDuration: 0,
      avgDuration: 0,
      avgRpe: null,
      avgCompliancePct: null,
    },
    trainingLoad: trainingLoad(),
    ...overrides,
  };
}

describe("buildOverviewChartFacts", () => {
  it("returns no chart sections for a brand-new athlete (no data)", () => {
    expect(buildOverviewChartFacts(overview())).toEqual({});
  });

  it("includes trainingLoad once the load trend has real UTSS", () => {
    const facts = buildOverviewChartFacts(
      overview({
        trainingLoad: trainingLoad({
          acwr: 1.1,
          zone: "sweet_spot",
          currentUtss: 60,
          trend: [
            trendPoint({ utss: 50, acwr: 1.0 }),
            trendPoint({ date: "2026-06-02", utss: 60, acwr: 1.1 }),
          ],
        }),
      }),
    );
    expect(facts.trainingLoad).toBeDefined();
    expect(facts.trainingLoad?.facts.zone).toBe("sweet_spot");
  });

  it("includes weeklyWorkouts, consistency and rpeDuration with 2+ weeks of history", () => {
    const facts = buildOverviewChartFacts(
      overview({
        weeklySummaries: [weekly(), weekly({ weekStart: "2026-06-08", workoutCount: 4 })],
        workoutDates: ["2026-06-02", "2026-06-09"],
        currentStreak: 2,
      }),
    );
    expect(facts.weeklyWorkouts).toBeDefined();
    expect(facts.consistency).toBeDefined();
    expect(facts.rpeDuration).toBeDefined();
  });

  it("omits charts whose data is too sparse to render", () => {
    const facts = buildOverviewChartFacts(
      overview({
        weeklySummaries: [weekly()],
        workoutDates: ["2026-06-02"],
      }),
    );
    // One weekly summary → the RPE/Duration mini charts (2+ points) don't render.
    expect(facts.rpeDuration).toBeUndefined();
    expect(facts.trainingLoad).toBeUndefined();
    expect(facts.weeklyWorkouts).toBeDefined();
    expect(facts.consistency).toBeDefined();
  });
});

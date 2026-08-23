import type {
  TrainingLoadOverview,
  TrainingLoadTrendPoint,
  TrainingOverview,
  WeeklySummary,
} from "@shared/schema";
import { describe, expect, it } from "vitest";

import { buildOverviewChartFacts, OVERVIEW_ANALYSIS_SYSTEM_PROMPT } from "../overviewAnalysisService";

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
    // Denominators for the period-level pooled aggregates (audit H8, H9).
    workoutsWithDuration: 3,
    rpeCount: 3,
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

describe("the metric reference the model is given (audit M27)", () => {
  it("does not tell the model UTSS is subjective", () => {
    // calculateCardioStressScore tries heart rate FIRST, then power, and only
    // then RPE — so a session with HR data barely uses RPE at all. The prompt
    // called UTSS "subjective (from RPE)", and the model repeated that to the
    // athlete as fact.
    expect(OVERVIEW_ANALYSIS_SYSTEM_PROMPT).not.toMatch(/UTSS is subjective/i);
    expect(OVERVIEW_ANALYSIS_SYSTEM_PROMPT).toMatch(/heart rate, then power, then/i);
  });

  it("does not tell the model hrTSS and UTSS should agree", () => {
    // They are on different scales and hrTSS never feeds UTSS — the load service
    // says so in its own comment. Inviting the model to reconcile them produced
    // readings about an "inconsistency" that is by design.
    expect(OVERVIEW_ANALYSIS_SYSTEM_PROMPT).not.toMatch(/should broadly agree/i);
    expect(OVERVIEW_ANALYSIS_SYSTEM_PROMPT).toMatch(/never feed UTSS/i);
  });
});

describe("window counts are not history counts (audit L15)", () => {
  /** A 42-day trend whose last `acwrDays` points carry a computed ratio. */
  function trendWithAcwr(acwrDays: number): TrainingLoadTrendPoint[] {
    const TREND_DAYS = 42;
    return Array.from({ length: TREND_DAYS }, (_, i) =>
      trendPoint({
        date: `day-${i}`,
        utss: 50,
        acwr: i >= TREND_DAYS - acwrDays ? 1.1 : null,
      }),
    );
  }

  const factsFor = (acwrDays: number) =>
    buildOverviewChartFacts(
      overview({ trainingLoad: trainingLoad({ acwr: 1.1, trend: trendWithAcwr(acwrDays) }) }),
    ).trainingLoad?.facts;

  it("no longer sends the model a fact called daysOfHistory", () => {
    // The prompt orders the model to cite the numbers it is given and invent
    // none, so the NAME is the instruction. A veteran scored 42 here.
    expect(factsFor(42)).not.toHaveProperty("daysOfHistory");
  });

  it("saturates at the window, which is why the old name was wrong", () => {
    // Three years of training and seven weeks of it produce the identical
    // number — there is no value of the count that means "days of history".
    expect(factsFor(42)?.acwrDaysInWindow).toBe(42);
    expect(factsFor(42)?.trendWindowDays).toBe(42);
  });

  it("ships the denominator so partial coverage is readable", () => {
    // An athlete 20 logged days in: ACWR needs 14, so 7 days carry a ratio.
    // Alone that reads as "a week of training"; with the window it reads as
    // "7 of the last 42 days have a ratio", which is what it is.
    const facts = factsFor(7);
    expect(facts?.acwrDaysInWindow).toBe(7);
    expect(facts?.trendWindowDays).toBe(42);
  });

  it("tells the model not to read history out of a window count", () => {
    expect(OVERVIEW_ANALYSIS_SYSTEM_PROMPT).toMatch(/NOT how long the athlete has trained/i);
    expect(OVERVIEW_ANALYSIS_SYSTEM_PROMPT).toMatch(/never tell the athlete how much history/i);
  });

  it("keeps the sibling consistency count named for its window too", () => {
    const facts = buildOverviewChartFacts(
      overview({ workoutDates: ["2026-06-02", "2026-06-09"], currentStreak: 2 }),
    ).consistency?.facts;

    expect(facts?.loggedDaysInWindow).toBe(2);
    expect(facts).not.toHaveProperty("daysOfHistory");
  });
});

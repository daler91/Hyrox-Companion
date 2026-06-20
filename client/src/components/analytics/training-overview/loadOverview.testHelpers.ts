import type { TrainingLoadOverview, TrainingLoadTrendPoint } from "@shared/schema";

/** Build a TrainingLoadTrendPoint with sensible defaults; override per test. */
export function trendPoint(overrides: Partial<TrainingLoadTrendPoint> = {}): TrainingLoadTrendPoint {
  return {
    date: "2026-05-01",
    utss: 50,
    acwr: 1,
    zone: "sweet_spot",
    tsb: 0,
    monotony: 1.2,
    strain: 300,
    trimp: null,
    tss: null,
    acuteEwma: 50,
    chronicEwma: 50,
    ...overrides,
  };
}

/** A minimal TrainingLoadOverview wrapping a given trend (other fields zeroed). */
export function overviewWithTrend(trend: TrainingLoadTrendPoint[]): TrainingLoadOverview {
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
    trimp: null,
    tss: null,
    flaggedVectors: [],
    activeRestrictions: [],
    downshiftRationale: null,
    trend,
  };
}

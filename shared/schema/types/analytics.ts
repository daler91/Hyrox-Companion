// Analytics — Training Overview types
import type { MovementPattern } from "../exercises";

export interface WeeklySummary {
  weekStart: string; // YYYY-MM-DD (Monday)
  workoutCount: number;
  totalDuration: number; // minutes
  avgRpe: number | null;
  categoryBreakdown: Record<string, number>;
}

export type LoadGovernorAcwrZone =
  | "insufficient_data"
  | "undertraining"
  | "sweet_spot"
  | "yellow"
  | "danger";

export type LoadGovernorVector =
  | "posterior_chain"
  | "anterior_chain"
  | "unilateral_stability"
  | "elastic_tendon";

export interface TrainingLoadTrendPoint {
  date: string;
  utss: number;
  acwr: number | null;
  zone: LoadGovernorAcwrZone;
}

export interface TrainingLoadRestriction {
  id: string;
  label: string;
  severity: "info" | "caution" | "danger";
  expiresOn: string | null;
  vector?: LoadGovernorVector;
  rationale: string;
}

export interface TrainingLoadOverview {
  currentUtss: number;
  acuteAvg: number;
  chronicAvg: number;
  acwr: number | null;
  zone: LoadGovernorAcwrZone;
  flaggedVectors: LoadGovernorVector[];
  activeRestrictions: TrainingLoadRestriction[];
  downshiftRationale: string | null;
  trend: TrainingLoadTrendPoint[];
}

export interface MovementPatternCoverage {
  pattern: MovementPattern;
  label: string;
  sessionCount: number;
  totalSets: number;
  lastTrained: string | null;
  daysSince: number | null;
}

/**
 * Compact aggregate stats that the Analytics Overview tab surfaces as four
 * delta-indicator cards. Computed for both the currently-visible date range
 * and the equal-length window immediately before it, so the client can
 * render "↑ X% vs previous period" without a second round-trip.
 */
export interface OverviewStats {
  /** Total number of logged workouts in the period. */
  totalWorkouts: number;
  /** Average workouts per calendar week across the period (one decimal). */
  avgPerWeek: number;
  /** Sum of all workout durations (minutes). */
  totalDuration: number;
  /**
   * Average duration per workout (minutes, rounded). Zero when there were
   * no durations recorded.
   */
  avgDuration: number;
  /** Mean of the per-week avgRpe values that had at least one RPE entry. */
  avgRpe: number | null;
  /** Mean adherence % across workouts that have compliance snapshots. */
  avgCompliancePct: number | null;
}

export interface TrainingOverview {
  weeklySummaries: WeeklySummary[];
  workoutDates: string[];
  categoryTotals: Record<string, { count: number; totalSets: number }>;
  stationCoverage: Array<{ station: string; lastTrained: string | null; daysSince: number | null }>;
  movementPatternCoverage: MovementPatternCoverage[];
  currentStreak: number;
  weeklyCompletedWorkouts: number;
  weeklyGoal: number;
  /** Current-period aggregate stats used for delta comparisons. */
  currentStats: OverviewStats;
  /**
   * Aggregate stats for the equal-length window immediately before the
   * current period. Omitted when the user picked "All time" (no prior
   * window exists) or when the query didn't include a lower bound.
   */
  previousStats?: OverviewStats;
  trainingLoad: TrainingLoadOverview;
}


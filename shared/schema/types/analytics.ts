// Analytics — Training Overview types
export interface WeeklySummary {
  weekStart: string; // YYYY-MM-DD (Monday)
  workoutCount: number;
  totalDuration: number; // minutes
  avgRpe: number | null;
  categoryBreakdown: Record<string, number>;
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
}


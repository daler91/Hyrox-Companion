// Analytics — Training Overview types
import type { HeatMapMuscle, MovementPattern, MuscleHeatMapBodyRegion } from "../exercises";

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

// Foster training-monotony band. "high_risk" (>2.0) is a strong overtraining /
// illness predictor; "elevated" (1.5–2.0) is an early warning.
export type TrainingMonotonyZone = "ok" | "elevated" | "high_risk";

export interface TrainingLoadTrendPoint {
  date: string;
  utss: number;
  acwr: number | null;
  zone: LoadGovernorAcwrZone;
  /** Training Stress Balance (chronic − acute EWMA), "Form". Null until seeded. */
  tsb: number | null;
  /** Foster monotony (mean ÷ SD of trailing 7-day UTSS). Null when SD is 0. */
  monotony: number | null;
  /** Foster strain (weekly UTSS × monotony). Null when monotony is null. */
  strain: number | null;
  /** Display-only objective internal load (Banister TRIMP). Null without HR. */
  trimp: number | null;
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
  /** Acute fatigue: 7-day EWMA of UTSS. */
  acuteAvg: number;
  /** Chronic fitness: 28-day EWMA of UTSS. */
  chronicAvg: number;
  acwr: number | null;
  zone: LoadGovernorAcwrZone;
  /** Training Stress Balance / "Form" (chronicAvg − acuteAvg). Null until seeded. */
  tsb: number | null;
  /** Foster monotony for the trailing 7 days. Null when SD is 0. */
  monotony: number | null;
  /** Foster strain (weekly UTSS × monotony). Null when monotony is null. */
  strain: number | null;
  monotonyZone: TrainingMonotonyZone;
  /** Display-only objective internal load (Banister TRIMP) for the current day. */
  trimp: number | null;
  /** Display-only objective external load (power TSS) for the current day. */
  tss: number | null;
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

export interface MuscleGroupCoverage {
  muscle: HeatMapMuscle;
  label: string;
  bodyRegion: MuscleHeatMapBodyRegion;
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
  muscleGroupCoverage: MuscleGroupCoverage[];
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

// Analytics — Race Predictor (predicted HYROX finish time)

export type RacePredictionConfidence = "low" | "medium" | "high";
/** Where a segment estimate came from: the athlete's logged splits, the
 *  division/gender benchmark, or a blend of the two. */
export type RacePredictionBasis = "logged" | "benchmark" | "blended";
/** Why the AI estimate was not used (deterministic fallback returned instead). */
export type RacePredictionAiUnavailableReason =
  | "ai_disabled"
  | "ai_consent_off"
  | "ai_budget_exceeded"
  | "ai_error";

export interface RaceSegmentPrediction {
  /** 1-based race order (1..16). */
  index: number;
  kind: "run" | "station";
  /** Canonical exercise key (e.g. "skierg", "run_1k"). */
  exerciseName: string;
  label: string;
  estimatedSeconds: number;
  basis: RacePredictionBasis;
  confidence: RacePredictionConfidence;
  /** Number of logged sets that informed this segment (0 when benchmark-only). */
  sampleSize: number;
}

/** Where the athlete's predicted finish would rank within the real field. */
export interface RacePredictionPercentile {
  /** Percent of the cohort the predicted finish would beat (1..99). */
  fasterThanPct: number;
  /** Human label for the cohort, e.g. "Open Men 40-44" or "Open Men (all ages)". */
  cohortLabel: string;
  /** Number of real results the rank was computed against. */
  cohortSize: number;
  /** Whether ranked against an age-specific cohort or division×gender. */
  basis: "age_group" | "division_gender";
}

export interface RacePredictionResponse {
  totalFinishSeconds: number;
  segments: RaceSegmentPrediction[];
  /** Modeled total transition (roxzone) time included in the finish, in seconds. */
  transitionSeconds: number;
  /** True when the AI estimation layer produced this prediction. */
  aiUsed: boolean;
  aiUnavailableReason?: RacePredictionAiUnavailableReason | null;
  overallConfidence: RacePredictionConfidence;
  /** AI narrative (markdown). Null on the deterministic fallback path. */
  narrative: string | null;
  division: "open" | "pro";
  gender: "male" | "female" | "prefer_not_to_say" | null;
  /** True when gender was withheld and a neutral standard was assumed. */
  genderAssumed: boolean;
  /** Canonical age band used for benchmarks/ranking, or null when all-ages. */
  ageGroup: string | null;
  /** True when the athlete's specific age group was not applied (unknown or too thin). */
  ageGroupAssumed: boolean;
  /** Where the finish ranks vs the real field, or null when no cohort applies. */
  percentile: RacePredictionPercentile | null;
  dataCompleteness: {
    stationsWithData: number;
    totalStations: number;
    hasRunData: boolean;
  };
  /** ISO timestamp the prediction was generated. */
  generatedAt: string;
}

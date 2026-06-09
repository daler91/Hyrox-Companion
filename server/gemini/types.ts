import type { CoachNoteInputs } from "@shared/schema";

import type { PromptExerciseSet } from "../prompts/exerciseSetFormatter";

/**
 * Compact summary of an athlete's MAF test history for the coaching context.
 * Surfaced only for MAF-method athletes. The trend is compliance/cadence-based
 * (how well recent tests held the MAF ceiling, and how recently the athlete
 * tested) — pace-at-fixed-HR isn't included because logged runs don't yet
 * carry distance.
 */
export interface MafTrendSummary {
  /** Total MAF tests the athlete has logged. */
  testCount: number;
  /** Whole days since the most recent MAF test, or null when none logged. */
  lastTestDaysAgo: number | null;
  /** Compliance classification of the most recent test, or null. */
  latestClassification: "compliant" | "mostly_compliant" | "over_ceiling" | null;
  /** Compliance percentage of the most recent test (0-100), or null. */
  latestCompliancePct: number | null;
  /** Direction of the compliance trend across logged tests. */
  complianceTrend: "improving" | "flat" | "declining" | "insufficient_data";
}

/**
 * Compact summary of an athlete's recent fuelling vs training load + targets,
 * injected into the coach chat and auto-suggestions context. Present only when
 * the nutrition feature is enabled AND the athlete has logged food or set a
 * target; absent otherwise so the prompt is unchanged for non-nutrition users.
 */
export interface NutritionCoachContext {
  /** Length of the look-back window in days. */
  windowDays: number;
  /** Days in the window with any food logged. */
  loggedDaysCount: number;
  avgCalories: number;
  avgProteinG: number;
  avgCarbG: number;
  avgFatG: number;
  /** The athlete's current daily target, when one is set. */
  target?: {
    calories: number | null;
    proteinG: number | null;
    carbG: number | null;
    fatG: number | null;
  };
  /** Up to 3 highest training-load days with that day's intake (to spot under-fuelling). */
  highLoadDays: Array<{ date: string; utss: number; calories: number; proteinG: number }>;
  /** Today's tracked micronutrients below 50% of reference intake, formatted e.g. "Iron 32%". */
  lowMicros: string[];
  /**
   * Pre/post fuelling target for the next upcoming planned session (Phase 3b),
   * from the athlete's saved expected duration/RPE or an estimate derived from
   * the planned exercise table. Absent when there is no upcoming planned day.
   */
  nextSessionFuelling?: {
    date: string;
    focus: string;
    /** Effective inputs fed to the calculator (null = calculator assumed a default). */
    durationMin: number | null;
    rpe: number | null;
    /** True when duration/RPE came from the exercise-table estimate, not athlete-set values. */
    estimated: boolean;
    preCarbG: number;
    postCarbG: number;
    postProteinG: number;
  };
}

export interface TrainingContext {
  totalWorkouts: number;
  completedWorkouts: number;
  plannedWorkouts: number;
  missedWorkouts: number;
  skippedWorkouts: number;
  completionRate: number;
  currentStreak: number;
  /** Persisted MAF aerobic heart-rate ceiling (bpm) from the user profile, when set. */
  mafHr?: number | null;
  /** MAF test history/trend summary; present only for MAF-method athletes. */
  mafTrend?: MafTrendSummary;
  weeklyGoal?: number;
  weightUnit?: string;
  distanceUnit?: string;
  /** Recent fuelling vs training load + targets; present only when the nutrition feature is on and the athlete has logged food or set a target. */
  nutrition?: NutritionCoachContext;
  recentWorkouts: Array<{
    date: string;
    focus: string;
    mainWorkout: string;
    status: string;
    rpe?: number | null;
    duration?: number | null;
    athleteNote?: string | null;
    exerciseDetails?: PromptExerciseSet[];
  }>;
  upcomingWorkouts?: Array<{
    planDayId?: string;
    date: string;
    focus: string;
    mainWorkout: string;
    accessory?: string | null;
    notes?: string | null;
    exerciseDetails?: PromptExerciseSet[];
    aiSource?: "rag" | "legacy" | "review" | "load_governor" | null;
    aiRationale?: string | null;
    aiNoteUpdatedAt?: string | Date | null;
    aiInputsUsed?: CoachNoteInputs | null;
  }>;
  exerciseBreakdown: Record<string, number>;
  structuredExerciseStats?: Record<
    string,
    {
      count: number;
      maxWeight?: number;
      maxDistance?: number;
      bestTime?: number;
      avgReps?: number;
    }
  >;
  activePlan?: {
    name: string;
    totalWeeks: number;
    currentWeek?: number;
    goal?: string | null;
  };
  coachingInsights?: {
    rpeTrend: "rising" | "stable" | "falling" | "insufficient_data";
    avgRpeLast3?: number;
    avgRpePrior3?: number;
    fatigueFlag: boolean;
    undertrainingFlag: boolean;
    stationGaps: Array<{
      station: string;
      daysSinceLastTrained: number | null;
    }>;
    planPhase?: {
      currentWeek: number;
      totalWeeks: number;
      phaseLabel: "early" | "build" | "peak" | "taper" | "race_week";
      progressPct: number;
      remainingPhases: Array<"early" | "build" | "peak" | "taper" | "race_week">;
    };
    weeklyVolume?: {
      thisWeekCompleted: number;
      lastWeekCompleted: number;
      goal: number;
      trend: "increasing" | "stable" | "decreasing";
    };
    loadGovernor?: {
      currentUtss: number;
      acuteAvg: number;
      chronicAvg: number;
      acwr: number | null;
      zone: "insufficient_data" | "undertraining" | "sweet_spot" | "yellow" | "danger";
      flaggedVectors: Array<"posterior_chain" | "anterior_chain" | "unilateral_stability" | "elastic_tendon">;
      activeRestrictions: Array<{
        id: string;
        label: string;
        severity: "info" | "caution" | "danger";
        expiresOn: string | null;
        vector?: "posterior_chain" | "anterior_chain" | "unilateral_stability" | "elastic_tendon";
        rationale: string;
      }>;
      downshiftRationale: string | null;
      trend: Array<{
        date: string;
        utss: number;
        acwr: number | null;
        zone: "insufficient_data" | "undertraining" | "sweet_spot" | "yellow" | "danger";
      }>;
    };
    progressionFlags: Array<{
      exercise: string;
      flag: "plateau" | "progressing" | "regressing" | "new";
      detail: string;
    }>;
    decisionTree?: {
      currentPhase: "reset_repair" | "aerobic_base" | "bridge" | "performance";
      allowedWorkoutTypes: Array<
        | "rest"
        | "mobility"
        | "easy_aerobic"
        | "skill_technique"
        | "strength"
        | "threshold"
        | "race_pace"
        | "hyrox_simulation"
      >;
      intensityPermitted: boolean;
      rationaleCodes: string[];
    };
  };
}

import type { CoachNoteInputs } from "@shared/schema";

import type { PromptExerciseSet } from "../prompts/exerciseSetFormatter";

export interface TrainingContext {
  totalWorkouts: number;
  completedWorkouts: number;
  plannedWorkouts: number;
  missedWorkouts: number;
  skippedWorkouts: number;
  completionRate: number;
  currentStreak: number;
  weeklyGoal?: number;
  weightUnit?: string;
  distanceUnit?: string;
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

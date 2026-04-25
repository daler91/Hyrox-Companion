export interface TrainingContext {
  totalWorkouts: number;
  completedWorkouts: number;
  plannedWorkouts: number;
  missedWorkouts: number;
  skippedWorkouts: number;
  completionRate: number;
  currentStreak: number;
  weeklyGoal?: number;
  recentWorkouts: Array<{
    date: string;
    focus: string;
    mainWorkout: string;
    status: string;
    rpe?: number | null;
    duration?: number | null;
    exerciseDetails?: Array<{
      name: string;
      setNumber?: number | null;
      reps?: number | null;
      weight?: number | null;
      distance?: number | null;
      time?: number | null;
    }>;
  }>;
  upcomingWorkouts?: Array<{
    planDayId?: string;
    date: string;
    focus: string;
    mainWorkout: string;
    accessory?: string | null;
    notes?: string | null;
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
    progressionFlags: Array<{
      exercise: string;
      flag: "plateau" | "progressing" | "regressing" | "new";
      detail: string;
    }>;
  };
}

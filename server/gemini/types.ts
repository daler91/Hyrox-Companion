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
}

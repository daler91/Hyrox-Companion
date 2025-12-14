export type FilterStatus = "all" | "completed" | "planned" | "missed" | "skipped";

export interface WorkoutSuggestion {
  workoutId: string;
  workoutDate: string;
  workoutFocus: string;
  recommendation: string;
  rationale: string;
  priority: "high" | "medium" | "low";
}

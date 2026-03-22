import { apiRequest } from "@/lib/queryClient";
import type { InsertWorkoutLog, UpdateWorkoutLog, ParsedExercise } from "@shared/schema";

export async function createWorkout(data: InsertWorkoutLog): Promise<any> {
  const response = await apiRequest("POST", "/api/v1/workouts", data);
  return response.json();
}

export async function updateWorkout(workoutId: string, updates: UpdateWorkoutLog): Promise<any> {
  const response = await apiRequest("PATCH", `/api/v1/workouts/${workoutId}`, updates);
  return response.json();
}

export async function deleteWorkout(workoutId: string): Promise<any> {
  const response = await apiRequest("DELETE", `/api/v1/workouts/${workoutId}`);
  return response.json();
}

export async function parseExercises(text: string): Promise<ParsedExercise[]> {
  const response = await apiRequest("POST", "/api/v1/parse-exercises", { text });
  return response.json();
}

export async function getTimeline(planId?: string | null): Promise<any> {
  const url = planId ? `/api/v1/timeline?planId=${planId}` : "/api/v1/timeline";
  const response = await apiRequest("GET", url);
  return response.json();
}

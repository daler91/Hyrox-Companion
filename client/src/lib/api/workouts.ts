import { apiRequest } from "@/lib/queryClient";
import type { InsertWorkoutLog, UpdateWorkoutLog, ParsedExercise } from "@shared/schema";

export async function createWorkout(data: Omit<InsertWorkoutLog, "userId">): Promise<any> {
  const response = await apiRequest("POST", "/api/v1/workouts", data);
  return response.json();
}

export async function updateWorkout(workoutId: string | number, updates: Omit<UpdateWorkoutLog, "userId">): Promise<any> {
  const response = await apiRequest("PATCH", `/api/v1/workouts/${workoutId}`, updates);
  return response.json();
}

export async function deleteWorkout(workoutId: string | number): Promise<void> {
  await apiRequest("DELETE", `/api/v1/workouts/${workoutId}`);
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

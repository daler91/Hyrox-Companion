import { typedRequest } from "./client";
import type {
  InsertWorkoutLog,
  UpdateWorkoutLog,
  WorkoutLog,
  ParsedExercise,
  ExerciseSet,
} from "@shared/schema";

export interface BatchReparseResponse {
  total: number;
  parsed: number;
  failed: number;
}

export const workouts = {
  create: (data: Omit<InsertWorkoutLog, "userId"> & { title?: string; exercises?: ParsedExercise[] }) =>
    typedRequest<{ message: string; workout: WorkoutLog }>("POST", "/api/v1/workouts", data),

  list: (params?: { limit?: number; offset?: number }) => {
    const qs = params
      ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString()}`
      : "";
    return typedRequest<WorkoutLog[]>("GET", `/api/v1/workouts${qs}`);
  },

  get: (id: string) => typedRequest<WorkoutLog & { exerciseSets?: ExerciseSet[] }>("GET", `/api/v1/workouts/${id}`),

  update: (id: string, data: UpdateWorkoutLog & { exercises?: ParsedExercise[] }) =>
    typedRequest<WorkoutLog>("PATCH", `/api/v1/workouts/${id}`, data),

  delete: (id: string) => typedRequest<{ success: boolean }>("DELETE", `/api/v1/workouts/${id}`),

  deleteAfterDate: (after: string) =>
    typedRequest<{ success: boolean; deletedCount: number }>("DELETE", `/api/v1/workouts?after=${after}`),

  getUnstructured: () => typedRequest<WorkoutLog[]>("GET", "/api/v1/workouts/unstructured"),

  reparse: (id: string) => typedRequest<WorkoutLog>("POST", `/api/v1/workouts/${id}/reparse`),

  batchReparse: () => typedRequest<BatchReparseResponse>("POST", "/api/v1/workouts/batch-reparse"),
} as const;

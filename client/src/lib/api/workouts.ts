import type {
  ExerciseSet,
  InsertWorkoutLog,
  ParsedExercise,
  UpdateWorkoutLog,
  WorkoutLog,
} from "@shared/schema";

import { typedRequest } from "./client";
import type { ParseFromImagePayload } from "./exercises";

export interface BatchReparseResponse {
  total: number;
  parsed: number;
  failed: number;
}

/**
 * Response from POST /api/v1/workouts/:id/reparse. `saved` is false when
 * the server couldn't extract any exercises from the free text — callers
 * should fall back to the empty-state UX in that case.
 */
export interface ReparseResponse {
  exercises: unknown[];
  saved: boolean;
  setCount?: number;
}

export interface WorkoutHistoryStats {
  lastSameFocus: { date: string; focus: string } | null;
  prSetCount: number;
  blockAvgRpe: number | null;
}

export type PatchExerciseSetPayload = Partial<{
  exerciseName: string;
  customLabel: string | null;
  category: string;
  setNumber: number;
  reps: number | null;
  weight: number | null;
  distance: number | null;
  time: number | null;
  notes: string | null;
  sortOrder: number | null;
}>;

export interface AddExerciseSetPayload {
  exerciseName: string;
  customLabel?: string | null;
  category: string;
  setNumber?: number;
  reps?: number | null;
  weight?: number | null;
  distance?: number | null;
  time?: number | null;
  notes?: string | null;
  confidence?: number | null;
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

  /**
   * Fetch the most recent workout log with its exercise sets embedded so the
   * client can hydrate a "duplicate last" prefill in one round-trip.
   * Returns 404 when the user has no prior workouts yet.
   */
  latest: () =>
    typedRequest<WorkoutLog & { exerciseSets: ExerciseSet[] }>("GET", "/api/v1/workouts/latest"),

  get: (id: string) => typedRequest<WorkoutLog & { exerciseSets?: ExerciseSet[] }>("GET", `/api/v1/workouts/${id}`),

  update: (id: string, data: UpdateWorkoutLog & { exercises?: ParsedExercise[] }) =>
    typedRequest<WorkoutLog>("PATCH", `/api/v1/workouts/${id}`, data),

  delete: (id: string) => typedRequest<{ success: boolean }>("DELETE", `/api/v1/workouts/${id}`),

  combine: (data: { newWorkout: Record<string, unknown>; deleteWorkoutIds: string[]; skipPlanDayIds?: string[] }) =>
    typedRequest<WorkoutLog>("POST", "/api/v1/workouts/combine", data),

  getUnstructured: () => typedRequest<WorkoutLog[]>("GET", "/api/v1/workouts/unstructured"),

  reparse: (id: string) =>
    typedRequest<ReparseResponse>("POST", `/api/v1/workouts/${id}/reparse`),

  reparseFromImage: (id: string, payload: ParseFromImagePayload) =>
    typedRequest<ReparseResponse>(
      "POST",
      `/api/v1/workouts/${id}/reparse-from-image`,
      payload,
    ),

  batchReparse: () => typedRequest<BatchReparseResponse>("POST", "/api/v1/workouts/batch-reparse"),

  // --- Set-level CRUD used by the structured exercises table in the v2
  // workout-detail dialog. Each cell edit fires an updateSet; +Add hits
  // addSet; row ⋮ → delete hits deleteSet.
  history: (id: string) => typedRequest<WorkoutHistoryStats>("GET", `/api/v1/workouts/${id}/history`),

  seedFromPlan: (id: string) =>
    typedRequest<{ seededCount: number }>("POST", `/api/v1/workouts/${id}/seed-from-plan`),

  updateSet: (workoutId: string, setId: string, data: PatchExerciseSetPayload) =>
    typedRequest<ExerciseSet>("PATCH", `/api/v1/workouts/${workoutId}/sets/${setId}`, data),

  addSet: (workoutId: string, data: AddExerciseSetPayload) =>
    typedRequest<ExerciseSet>("POST", `/api/v1/workouts/${workoutId}/sets`, data),

  deleteSet: (workoutId: string, setId: string) =>
    typedRequest<{ success: boolean }>("DELETE", `/api/v1/workouts/${workoutId}/sets/${setId}`),
} as const;

import type {
  ExerciseSet,
  InsertWorkoutLog,
  ParsedExercise,
  StructureBlockInput,
  UpdateWorkoutLog,
  WorkoutLog,
} from "@shared/schema";

import { typedRequest } from "./client";
import type { ReparseResponse } from "./constants";
import { IMAGE_REPARSE_REQUEST_OPTIONS } from "./constants";
import type { ParseFromImagePayload } from "./exercises";
import { createExerciseSetMutationApi } from "./exerciseSetMutations";

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
export interface WorkoutReferenceTextPayload {
  prescribedMainWorkout?: string | null;
  prescribedAccessory?: string | null;
  prescribedNotes?: string | null;
}

export type ReparseWorkoutTextPayload = Pick<
  WorkoutReferenceTextPayload,
  "prescribedMainWorkout" | "prescribedAccessory"
>;

export interface WorkoutHistoryStats {
  lastSameFocus: { date: string; focus: string } | null;
  prSetCount: number;
  blockAvgRpe: number | null;
}

export const workouts = {
  // Server returns the bare WorkoutLog with `exerciseSets` embedded when
  // a `planDayId` is supplied (see workoutService.copyPrescribedSetsIntoLog).
  create: (data: Omit<InsertWorkoutLog, "userId"> & { title?: string; exercises?: ParsedExercise[]; structureBlocks?: StructureBlockInput[] }) =>
    typedRequest<WorkoutLog & { exerciseSets?: ExerciseSet[]; structureBlocks?: unknown[] }>("POST", "/api/v1/workouts", data),

  list: (params?: { limit?: number; offset?: number }) => {
    let qs = "";
    if (params) {
      // ⚡ Bolt Performance Optimization:
      // Replaced chained `.filter(...).map(...)` on `Object.entries` with a single for...of loop.
      // This eliminates an intermediate array allocation and a double O(N) traversal.
      const searchParams = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v != null) {
          searchParams.append(k, String(v));
        }
      }
      const searchString = searchParams.toString();
      qs = searchString ? `?${searchString}` : "";
    }
    return typedRequest<WorkoutLog[]>("GET", `/api/v1/workouts${qs}`);
  },

  /**
   * Fetch the most recent workout log with its exercise sets embedded so the
   * client can hydrate a "duplicate last" prefill in one round-trip.
   * Returns 404 when the user has no prior workouts yet.
   */
  latest: () =>
    typedRequest<WorkoutLog & { exerciseSets: ExerciseSet[]; structureBlocks?: unknown[] }>("GET", "/api/v1/workouts/latest"),

  get: (id: string) => typedRequest<WorkoutLog & { exerciseSets?: ExerciseSet[]; structureBlocks?: unknown[] }>("GET", `/api/v1/workouts/${id}`),

  update: (id: string, data: UpdateWorkoutLog & { exercises?: ParsedExercise[]; structureBlocks?: StructureBlockInput[] }) =>
    typedRequest<WorkoutLog>("PATCH", `/api/v1/workouts/${id}`, data),

  delete: (id: string) => typedRequest<{ success: boolean }>("DELETE", `/api/v1/workouts/${id}`),

  combine: (data: { newWorkout: Record<string, unknown>; deleteWorkoutIds: string[]; skipPlanDayIds?: string[] }) =>
    typedRequest<WorkoutLog>("POST", "/api/v1/workouts/combine", data),

  getUnstructured: () => typedRequest<WorkoutLog[]>("GET", "/api/v1/workouts/unstructured"),

  reparse: (id: string, payload?: ReparseWorkoutTextPayload) =>
    payload === undefined
      ? typedRequest<ReparseResponse>("POST", `/api/v1/workouts/${id}/reparse`)
      : typedRequest<ReparseResponse>("POST", `/api/v1/workouts/${id}/reparse`, payload),

  reparseFromImage: (id: string, payload: ParseFromImagePayload) =>
    typedRequest<ReparseResponse>(
      "POST",
      `/api/v1/workouts/${id}/reparse-from-image`,
      payload,
      IMAGE_REPARSE_REQUEST_OPTIONS,
    ),

  batchReparse: () => typedRequest<BatchReparseResponse>("POST", "/api/v1/workouts/batch-reparse"),

  // --- Set-level CRUD used by the structured exercises table in the v2
  // workout-detail dialog. Each cell edit fires an updateSet; +Add hits
  // addSet; row ⋮ → delete hits deleteSet.
  history: (id: string) => typedRequest<WorkoutHistoryStats>("GET", `/api/v1/workouts/${id}/history`),

  seedFromPlan: (id: string) =>
    typedRequest<{ seededCount: number }>("POST", `/api/v1/workouts/${id}/seed-from-plan`),

  ...createExerciseSetMutationApi((workoutId) => `/api/v1/workouts/${workoutId}`),
} as const;

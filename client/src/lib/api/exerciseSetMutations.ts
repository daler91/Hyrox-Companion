import type { ExerciseSet } from "@shared/schema";

import { typedRequest } from "./client";

export type PatchExerciseSetPayload = Partial<{
  exerciseName: string;
  customLabel: string | null;
  category: string;
  setNumber: number;
  reps: number | null;
  weight: number | null;
  distance: number | null;
  time: number | null;
  plannedReps: number | null;
  plannedWeight: number | null;
  plannedDistance: number | null;
  plannedTime: number | null;
  blockId: string | null;
  stepNumber: number | null;
  intervalMinute: number | null;
  cycleNumber: number | null;
  stepRole: string | null;
  groupId: string | null;
  notes: string | null;
  sortOrder: number | null;
  /**
   * Optimistic lock (server W18, finding D5): the row version this edit was
   * made against. The server rejects the PATCH with 409 when another writer
   * has bumped it since. Omitted only when the client has no version to send.
   */
  expectedVersion: number;
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
  plannedReps?: number | null;
  plannedWeight?: number | null;
  plannedDistance?: number | null;
  plannedTime?: number | null;
  blockId?: string | null;
  stepNumber?: number | null;
  intervalMinute?: number | null;
  cycleNumber?: number | null;
  stepRole?: string | null;
  groupId?: string | null;
  notes?: string | null;
  confidence?: number | null;
  sourceSetId?: string | null;
}

export type ExerciseSetMutationApi = {
  updateSet: (ownerId: string, setId: string, data: PatchExerciseSetPayload) => Promise<ExerciseSet>;
  addSet: (ownerId: string, data: AddExerciseSetPayload) => Promise<ExerciseSet>;
  deleteSet: (ownerId: string, setId: string) => Promise<{ success: boolean }>;
};

export function createExerciseSetMutationApi(basePath: (ownerId: string) => string): ExerciseSetMutationApi {
  return {
    updateSet: (ownerId, setId, data) =>
      typedRequest<ExerciseSet>("PATCH", `${basePath(ownerId)}/sets/${setId}`, data, { timeoutMs: 10_000 }),
    addSet: (ownerId, data) =>
      typedRequest<ExerciseSet>("POST", `${basePath(ownerId)}/sets`, data, { timeoutMs: 10_000 }),
    deleteSet: (ownerId, setId) =>
      typedRequest<{ success: boolean }>("DELETE", `${basePath(ownerId)}/sets/${setId}`, undefined, { timeoutMs: 10_000 }),
  };
}

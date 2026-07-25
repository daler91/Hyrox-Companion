import { type AddExerciseSetBody, type PatchExerciseSetBody } from "@shared/schema";

import { invalidateAnalyticsCachesForUser } from "../../services/analyticsRouteCache";

export type ExerciseSetOwnerKind = "workoutLog" | "planDay";

export type ExerciseSetOwnerRef = {
  kind: ExerciseSetOwnerKind;
  ownerId: string;
};

export interface ExerciseSetMutationStorage {
  updateSet: (owner: ExerciseSetOwnerRef, setId: string, body: PatchExerciseSetBody, userId: string) => Promise<unknown>;
  addSet: (owner: ExerciseSetOwnerRef, body: AddExerciseSetBody, userId: string) => Promise<unknown>;
  deleteSet: (owner: ExerciseSetOwnerRef, setId: string, userId: string) => Promise<boolean>;
}

/**
 * Editing a LOGGED set changes every derived analytic computed from it, so the
 * coalesced analytics caches must drop this athlete's slices — otherwise the
 * Analytics tabs answer with pre-edit numbers for up to the cache TTL while the
 * workout screen already shows the new value. Planned-day sets are excluded:
 * nothing in the analytics routes is computed from them.
 */
function invalidateDerivedCaches(owner: ExerciseSetOwnerRef, userId: string): void {
  if (owner.kind === "workoutLog") invalidateAnalyticsCachesForUser(userId);
}

export const createMutateExerciseSetUseCase = (storage: ExerciseSetMutationStorage) => ({
  updateSet: async (owner: ExerciseSetOwnerRef, setId: string, body: PatchExerciseSetBody, userId: string) => {
    const updated = await storage.updateSet(owner, setId, body, userId);
    if (updated) invalidateDerivedCaches(owner, userId);
    return updated;
  },
  addSet: async (owner: ExerciseSetOwnerRef, body: AddExerciseSetBody, userId: string) => {
    const created = await storage.addSet(owner, body, userId);
    if (created) invalidateDerivedCaches(owner, userId);
    return created;
  },
  deleteSet: async (owner: ExerciseSetOwnerRef, setId: string, userId: string) => {
    const deleted = await storage.deleteSet(owner, setId, userId);
    if (deleted) invalidateDerivedCaches(owner, userId);
    return deleted;
  },
});

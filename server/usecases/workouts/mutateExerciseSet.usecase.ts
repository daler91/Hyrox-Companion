import { type AddExerciseSetBody, type PatchExerciseSetBody } from "@shared/schema";
import { stampForPreferences, type UnitPreferences } from "@shared/unitConversion";

import { invalidateAnalyticsCachesForUser } from "../../services/analyticsRouteCache";
import { refreshDerivedStateAfterLoggedSetChange } from "../../services/workoutService/loggedSetChange";

export type ExerciseSetOwnerKind = "workoutLog" | "planDay";

export type ExerciseSetOwnerRef = {
  kind: ExerciseSetOwnerKind;
  ownerId: string;
};

/** A patch plus the units its numbers are in, so storage can keep the row's stamp true. */
export type StampedPatchExerciseSetBody = PatchExerciseSetBody & { unitPreferences: UnitPreferences };

export interface ExerciseSetMutationStorage {
  updateSet: (owner: ExerciseSetOwnerRef, setId: string, body: StampedPatchExerciseSetBody, userId: string) => Promise<unknown>;
  addSet: (owner: ExerciseSetOwnerRef, body: AddExerciseSetBody, userId: string) => Promise<unknown>;
  deleteSet: (owner: ExerciseSetOwnerRef, setId: string, userId: string) => Promise<boolean>;
  /** The athlete's current units — what every number in a request body is in. */
  getUnitPreferences: (userId: string) => Promise<UnitPreferences>;
}

/**
 * Editing a LOGGED set changes everything derived from it, so each write ends
 * by re-deriving those things:
 *
 *   - the coalesced analytics caches drop this athlete's slices, or the
 *     Analytics tabs answer with pre-edit numbers for up to the cache TTL while
 *     the workout screen already shows the new value;
 *   - the adherence snapshot and the coach note are recomputed, or correcting a
 *     session to the exercises actually performed leaves a compliance
 *     percentage and a coach note describing the exercises that were replaced.
 *
 * Awaited rather than fired-and-forgotten so the response the client refetches
 * on already reflects the new adherence columns. The refresh swallows its own
 * failures: the set write has committed, so a stale note must not turn a saved
 * edit into a failed request.
 *
 * Planned-day sets are excluded from all of it: they are the prescription, not
 * a performance, so nothing downstream is computed from them.
 */
async function refreshDerivedState(owner: ExerciseSetOwnerRef, userId: string): Promise<void> {
  if (owner.kind !== "workoutLog") return;
  invalidateAnalyticsCachesForUser(userId);
  await refreshDerivedStateAfterLoggedSetChange(owner.ownerId, userId);
}

/**
 * Every number a set-mutation request carries is in the athlete's CURRENT unit
 * preference (that is what the client shows and edits), so this layer is where
 * the row's unit stamp (audit L4) gets written: a new row is stamped outright,
 * and a patch carries the preferences so storage can re-stamp the axes it
 * touches — converting any untouched value on those axes from the old stamp
 * first, so one stamp stays true for the whole row. Before this, "+Add row"
 * created permanently unstamped rows and a weight edit after a kg↔lbs switch
 * stored a new-unit number under the old stamp.
 */
export const createMutateExerciseSetUseCase = (storage: ExerciseSetMutationStorage) => ({
  updateSet: async (owner: ExerciseSetOwnerRef, setId: string, body: PatchExerciseSetBody, userId: string) => {
    const unitPreferences = await storage.getUnitPreferences(userId);
    const updated = await storage.updateSet(owner, setId, { ...body, unitPreferences }, userId);
    if (updated) await refreshDerivedState(owner, userId);
    return updated;
  },
  addSet: async (owner: ExerciseSetOwnerRef, body: AddExerciseSetBody, userId: string) => {
    const stamp = stampForPreferences(await storage.getUnitPreferences(userId));
    const created = await storage.addSet(owner, { ...body, ...stamp }, userId);
    if (created) await refreshDerivedState(owner, userId);
    return created;
  },
  deleteSet: async (owner: ExerciseSetOwnerRef, setId: string, userId: string) => {
    const deleted = await storage.deleteSet(owner, setId, userId);
    if (deleted) await refreshDerivedState(owner, userId);
    return deleted;
  },
});

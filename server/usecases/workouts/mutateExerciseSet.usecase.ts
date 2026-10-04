import { type AddExerciseSetBody, type PatchExerciseSetBody } from "@shared/schema";
import {
  stampForPreferences,
  type StoredDistanceUnit,
  type UnitPreferences,
  type WeightUnit,
} from "@shared/unitConversion";

import { invalidateAnalyticsCachesForUser } from "../../services/analyticsRouteCache";
import { refreshDerivedStateAfterLoggedSetChange } from "../../services/workoutService/loggedSetChange";

export type ExerciseSetOwnerKind = "workoutLog" | "planDay";

export type ExerciseSetOwnerRef = {
  kind: ExerciseSetOwnerKind;
  ownerId: string;
};

/** The units a request body says its numbers were composed in (D22). */
type ComposedUnits = Pick<PatchExerciseSetBody, "weightUnit" | "distanceUnit">;

/**
 * A patch plus the units its numbers are in, so storage can keep the row's
 * stamp true. The body's own unit fields are consumed into `unitPreferences`:
 * passed through, they would land on the row as a stamp no value was converted to.
 */
export type StampedPatchExerciseSetBody = Omit<PatchExerciseSetBody, keyof ComposedUnits> & {
  unitPreferences: UnitPreferences;
};

/** A new row and the stamp it is written with. */
export type StampedAddExerciseSetBody = Omit<AddExerciseSetBody, keyof ComposedUnits> & {
  weightUnit: WeightUnit;
  distanceUnit: StoredDistanceUnit;
};

export interface ExerciseSetMutationStorage {
  updateSet: (owner: ExerciseSetOwnerRef, setId: string, body: StampedPatchExerciseSetBody, userId: string) => Promise<unknown>;
  addSet: (owner: ExerciseSetOwnerRef, body: StampedAddExerciseSetBody, userId: string) => Promise<unknown>;
  deleteSet: (owner: ExerciseSetOwnerRef, setId: string, userId: string) => Promise<boolean>;
  /** The athlete's current units — what a request body's numbers are in when it names none. */
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
 * The units a request's numbers are in: the ones the client says it composed
 * them in, per axis, else the athlete's current preference.
 *
 * The client converts for display with the preferences it has cached, which a
 * unit switch on another device leaves stale. Reading the server's preference
 * here stamped a number typed under a "kg" header as lbs (D22,
 * CODEBASE_ANALYSIS_2026-10-03). A body without units — an older client — keeps
 * the old reading.
 */
async function unitsForRequest(
  storage: ExerciseSetMutationStorage,
  userId: string,
  composed: ComposedUnits,
): Promise<UnitPreferences> {
  if (composed.weightUnit && composed.distanceUnit) {
    return { weightUnit: composed.weightUnit, distanceUnit: composed.distanceUnit };
  }
  const current = await storage.getUnitPreferences(userId);
  return {
    weightUnit: composed.weightUnit ?? current.weightUnit,
    distanceUnit: composed.distanceUnit ?? current.distanceUnit,
  };
}

/**
 * This layer is where the row's unit stamp (audit L4) gets written, in the
 * units the request's numbers are in (unitsForRequest): a new row is stamped
 * outright, and a patch carries the units so storage can re-stamp the axes it
 * touches — converting any untouched value on those axes from the old stamp
 * first, so one stamp stays true for the whole row. Before this, "+Add row"
 * created permanently unstamped rows and a weight edit after a kg↔lbs switch
 * stored a new-unit number under the old stamp.
 */
export const createMutateExerciseSetUseCase = (storage: ExerciseSetMutationStorage) => ({
  updateSet: async (owner: ExerciseSetOwnerRef, setId: string, body: PatchExerciseSetBody, userId: string) => {
    const { weightUnit, distanceUnit, ...patch } = body;
    const unitPreferences = await unitsForRequest(storage, userId, { weightUnit, distanceUnit });
    const updated = await storage.updateSet(owner, setId, { ...patch, unitPreferences }, userId);
    if (updated) await refreshDerivedState(owner, userId);
    return updated;
  },
  addSet: async (owner: ExerciseSetOwnerRef, body: AddExerciseSetBody, userId: string) => {
    const { weightUnit, distanceUnit, ...fields } = body;
    const stamp = stampForPreferences(await unitsForRequest(storage, userId, { weightUnit, distanceUnit }));
    const created = await storage.addSet(owner, { ...fields, ...stamp }, userId);
    if (created) await refreshDerivedState(owner, userId);
    return created;
  },
  deleteSet: async (owner: ExerciseSetOwnerRef, setId: string, userId: string) => {
    const deleted = await storage.deleteSet(owner, setId, userId);
    if (deleted) await refreshDerivedState(owner, userId);
    return deleted;
  },
});

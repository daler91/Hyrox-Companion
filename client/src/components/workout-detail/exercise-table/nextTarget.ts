import type { NextTarget } from "@shared/progression";
import type { ExerciseSet } from "@shared/schema";

import type { PatchExerciseSetPayload } from "@/lib/api";

// The progression rules live in shared/ so the workout engine's auto-progression
// writes the same target into the plan that this chip suggests while logging.
export { type NextTarget, suggestNextTarget } from "@shared/progression";

/**
 * Patches that write the suggested target onto every current set.
 *
 * Unlike "use last" (a pairwise carry of whatever varied), the target is
 * uniform by construction, so every set the athlete has open gets the same
 * reps and weight — however many sets that is today.
 */
export function buildUseNextPatches(
  currentSets: readonly ExerciseSet[],
  target: NextTarget,
): Array<{ readonly setId: string; readonly patch: PatchExerciseSetPayload }> {
  return currentSets.map((set) => ({
    setId: set.id,
    patch: { reps: target.reps, weight: target.weight },
  }));
}

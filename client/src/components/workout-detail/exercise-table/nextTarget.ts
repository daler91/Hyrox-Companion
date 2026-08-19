import type { ExerciseSet } from "@shared/schema";

import type { PatchExerciseSetPayload } from "@/lib/api";

import { computeUniformity } from "./metrics";

/** A suggested prescription for the next session of an exercise. */
export interface NextTarget {
  /** Same set count as last time — the suggestion changes intensity, not volume. */
  readonly setCount: number;
  readonly reps: number;
  readonly weight: number;
  /** The single thing that moved versus last session, for the "+1 rep" badge. */
  readonly step:
    | { readonly field: "reps"; readonly amount: 1 }
    | { readonly field: "weight"; readonly amount: number };
}

// Same bounds as the estimated-1RM PR metric in
// server/services/analyticsService.ts: Epley is only trusted for 2–10 rep
// strength sets, so a suggestion derived from it holds to the same range.
const EPLEY_MIN_REPS = 2;
const EPLEY_MAX_REPS = 10;

const WEIGHT_INCREMENT: Readonly<Record<"kg" | "lb", number>> = { kg: 2.5, lb: 5 };

// A plate jump on a very light implement at the rep ceiling can leap the
// estimated 1RM by 20%+. Past this fraction the suggestion would be a
// programme change, not an overload — stay silent instead.
const MAX_E1RM_GAIN_FRACTION = 0.1;

function epley(weight: number, reps: number): number {
  return weight * (1 + reps / 30);
}

function roundWeight(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The next target for a strength exercise, progressed from its last session.
 *
 * "Last time and stop" leaves the actual decision — what to put on the bar —
 * entirely to the athlete. This closes that gap with the gentlest overload
 * that still beats last session's estimated 1RM: +1 rep at the same weight,
 * or +one plate step (2.5 kg / 5 lb) at the same reps, whichever raises the
 * Epley estimate less. Light work therefore progresses by reps and heavy work
 * by plates, with the crossover decided by the same 1RM math the PR tracker
 * already uses. At the 10-rep ceiling only the plate step remains, so reps
 * build to 10 and then weight moves.
 *
 * Returns null — no suggestion rather than a bad one — when the maths has no
 * footing: non-strength work, missing or varying weight/reps, sets outside
 * the 2–10 rep Epley range, or an implement so light the smallest available
 * step would jump the estimate by more than 10%.
 */
export function suggestNextTarget(
  lastSets: readonly ExerciseSet[],
  args: { readonly category: string; readonly weightUnit: "kg" | "lb" },
): NextTarget | null {
  if (args.category !== "strength") return null;

  const uniformity = computeUniformity(lastSets);
  const { weight, reps } = uniformity;
  if (weight == null || uniformity.weightVaries || reps == null || uniformity.repsVaries) {
    return null;
  }
  if (weight <= 0 || reps < EPLEY_MIN_REPS || reps > EPLEY_MAX_REPS) return null;

  const increment = WEIGHT_INCREMENT[args.weightUnit];
  const lastE1rm = epley(weight, reps);

  const weightGain = epley(weight + increment, reps) - lastE1rm;
  const repsGain = reps < EPLEY_MAX_REPS ? epley(weight, reps + 1) - lastE1rm : null;

  if (repsGain != null && repsGain < weightGain) {
    return {
      setCount: lastSets.length,
      reps: reps + 1,
      weight,
      step: { field: "reps", amount: 1 },
    };
  }
  if (weightGain > lastE1rm * MAX_E1RM_GAIN_FRACTION) return null;
  return {
    setCount: lastSets.length,
    reps,
    weight: roundWeight(weight + increment),
    step: { field: "weight", amount: increment },
  };
}

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

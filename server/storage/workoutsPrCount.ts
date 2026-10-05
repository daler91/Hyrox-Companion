import { storedWeightToKg, type UnitPreferences } from "@shared/unitConversion";

// The pure halves of WorkoutStorage's PR-set count, kept apart from the
// storage class so it stays within its size budget.

// Count distinct exercises in a logged workout that BEAT the user's previous
// best weight for that exercise. "Conservative PR" — we only credit exercises
// that include a weighted set; running/time/distance PRs are not counted here.
// Extracted as a pure function so the storage method stays within Sonar's
// cognitive-complexity ceiling.
//
// `maxByExercise` must be the athlete's best EXCLUDING this workout. It used to
// include it, and the test was `>=`, so the comparison could not tell a new
// best from a tie: the set was measured against a maximum it was itself inside,
// and repeating last week's 120 kg was reported as a fresh PR (audit M12).
// `analyticsService.updateMaxWeight` has always used a strict `>`; these two PR
// paths disagreed.
export function countPrSets(
  workoutSets: Array<{ exerciseName: string; weight: number | null }>,
  maxByExercise: Map<string, number | null>,
): number {
  const counted = new Set<string>();
  let prs = 0;
  for (const set of workoutSets) {
    if (set.weight == null || counted.has(set.exerciseName)) continue;
    const previousBest = maxByExercise.get(set.exerciseName);
    // No prior best means this is the athlete's first weighted attempt at the
    // movement, which is a baseline rather than a record — unchanged from the
    // previous behaviour, where the `max != null` guard did the same job.
    if (previousBest != null && set.weight > previousBest) {
      prs++;
      counted.add(set.exerciseName);
    }
  }
  return prs;
}

/** A workout's sets with each weight read in kg through its own unit stamp (C45). */
export function setsInKg(
  workoutSets: readonly {
    exerciseName: string;
    weight: number | null;
    weightUnit: string | null;
  }[],
  preferences: UnitPreferences,
): Array<{ exerciseName: string; weight: number | null }> {
  return workoutSets.map(({ exerciseName, weight, weightUnit }) => ({
    exerciseName,
    weight: weight == null ? null : storedWeightToKg(weight, { weightUnit }, preferences),
  }));
}

/**
 * Each exercise's heaviest earlier set in kg, from per-exercise, per-stamp
 * maxima: a lbs best and a kg best are converted before they are compared, and
 * a legacy (unstamped) row is read in the athlete's current unit (C45,
 * CODEBASE_ANALYSIS_2026-10-03).
 */
export function bestPriorWeightsKg(
  maxima: readonly { exerciseName: string; weightUnit: string | null; maxWeight: number | null }[],
  preferences: UnitPreferences,
): Map<string, number> {
  const best = new Map<string, number>();
  for (const { exerciseName, weightUnit, maxWeight } of maxima) {
    if (maxWeight == null) continue;
    const kg = storedWeightToKg(Number(maxWeight), { weightUnit }, preferences);
    const current = best.get(exerciseName);
    if (current === undefined || kg > current) best.set(exerciseName, kg);
  }
  return best;
}

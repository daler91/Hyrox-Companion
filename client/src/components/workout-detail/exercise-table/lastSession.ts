import type { ExerciseSet } from "@shared/schema";

import type { PatchExerciseSetPayload } from "@/lib/api";
import type { ExerciseSetWithDate } from "@/lib/api/exercises";

import { formatPrescription, type Prescription } from "../../exercise-row/formatPrescription";
import { buildPrimaryMetric, computeUniformity, shouldShowLoad } from "./metrics";

export interface LastSession {
  /** YYYY-MM-DD of the session these sets came from. */
  readonly date: string;
  readonly sets: readonly ExerciseSet[];
}

/**
 * The most recent past session for an exercise.
 *
 * `excludeWorkoutLogId` is load-bearing: opening a completed workout would
 * otherwise quote its own sets back as "last time", since they are in the
 * history too.
 */
export function pickLastSession(
  history: readonly ExerciseSetWithDate[],
  excludeWorkoutLogId?: string | null,
): LastSession | null {
  let latest: string | null = null;
  for (const set of history) {
    if (excludeWorkoutLogId && set.workoutLogId === excludeWorkoutLogId) continue;
    if (!latest || set.date > latest) latest = set.date;
  }
  if (!latest) return null;

  const sets = history.filter(
    (set) =>
      set.date === latest && !(excludeWorkoutLogId && set.workoutLogId === excludeWorkoutLogId),
  );
  if (sets.length === 0) return null;

  return { date: latest, sets: [...sets].sort((a, b) => (a.setNumber ?? 0) - (b.setNumber ?? 0)) };
}

/**
 * "4 × 8 reps · 80 kg" for a past session.
 *
 * Composed from the same three helpers the row already uses to describe the
 * current sets, so last time and this time can never be formatted differently.
 */
export function summariseLastSession(
  session: LastSession,
  args: {
    readonly exerciseName: string;
    readonly category: string;
    readonly weightUnit: "kg" | "lb";
    readonly distanceUnit: "km" | "miles";
  },
): Prescription {
  const sets = [...session.sets];
  const uniformity = computeUniformity(sets);
  const metric = buildPrimaryMetric(args.exerciseName, uniformity, args.distanceUnit);
  const hasWeight = shouldShowLoad(
    { exerciseName: args.exerciseName, category: args.category, sets },
    metric.field,
  );

  return formatPrescription({
    setCount: sets.length,
    metricValue: metric.value,
    metricSuffix: metric.suffix ?? "",
    metricVaries: metric.varies,
    weightValue: uniformity.weight,
    weightUnit: args.weightUnit,
    weightVaries: uniformity.weightVaries,
    hasWeight,
  });
}

/** The measurable fields "use last" copies forward. */
const CARRIED_FIELDS = ["reps", "weight", "distance", "time"] as const;

/**
 * Patches that fill the current sets from the last session's, pairwise by
 * position.
 *
 * Only overlapping positions are touched — this fills in what to aim for, it
 * does not add or delete sets, so an athlete who has dropped to 3 sets keeps 3.
 * A field the last session left blank is skipped rather than written as null,
 * so "use last" can never erase something already entered.
 */
export function buildUseLastPatches(
  currentSets: readonly ExerciseSet[],
  lastSets: readonly ExerciseSet[],
): Array<{ readonly setId: string; readonly patch: PatchExerciseSetPayload }> {
  const patches: Array<{ setId: string; patch: PatchExerciseSetPayload }> = [];

  for (let i = 0; i < currentSets.length; i++) {
    const current = currentSets[i];
    const last = lastSets[i];
    if (!current || !last) break;

    const patch: PatchExerciseSetPayload = {};
    for (const field of CARRIED_FIELDS) {
      const value = last[field];
      if (value != null) patch[field] = value;
    }
    if (Object.keys(patch).length > 0) patches.push({ setId: current.id, patch });
  }

  return patches;
}

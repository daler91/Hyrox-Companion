import type { ExerciseSet } from "@shared/schema";
import {
  type DistanceUnit,
  getStoredDistanceUnit,
  standardizeWeightUnit,
  type WeightUnit,
} from "@shared/unitConversion";
import { formatMinutes, minutes } from "@shared/units";

import { getExerciseLabel } from "@/lib/exerciseUtils";
import { toPreferenceScaleAll } from "@/lib/setDisplay";

/**
 * The athlete's distance preference, required rather than defaulted.
 *
 * `exercise_sets.distance` is stored in the athlete's OWN unit -- metres for a
 * km athlete, FEET for a miles athlete (`getStoredDistanceUnit`). This summary
 * appended "m" unconditionally, so a 400 m sled pull stored as 1312 ft rendered
 * as "1312m": a 3.28x overstatement carrying the wrong label (audit H16).
 *
 * There is no safe default here -- guessing metric is what produced the bug --
 * so callers must pass the preference they already hold.
 *
 * The weight preference is needed for the same reason: the weight used to be
 * written with no unit at all, and a row stamped in another unit is converted
 * to the preference before it is labelled (finding D2).
 */
export interface StructureSummaryUnits {
  readonly weightUnit: WeightUnit;
  readonly distanceUnit: DistanceUnit;
}

function formatTargets(set: ExerciseSet, units: StructureSummaryUnits): string {
  const parts: string[] = [];
  if (set.reps != null) parts.push(`${set.reps} reps`);
  if (set.weight != null) parts.push(`${set.weight}${standardizeWeightUnit(units.weightUnit)}`);
  if (set.distance != null) {
    parts.push(`${set.distance}${getStoredDistanceUnit(units.distanceUnit)}`);
  }
  // exercise_sets.time is minutes, and can be fractional now that seconds-valued
  // step targets are converted on the way in (audit C7). formatMinutes renders a
  // sub-minute value as seconds rather than as "0.75min".
  if (set.time != null) parts.push(formatMinutes(minutes(set.time)));
  return parts.join(" · ");
}

function getLegacyLabel(set: ExerciseSet): string {
  return getExerciseLabel(set.exerciseName, set.customLabel);
}

function getBlockKey(
  set: ExerciseSet,
  previousLegacyLabel: string | null,
  legacySegment: number,
): { key: string; nextLegacyLabel: string | null; nextLegacySegment: number } {
  if (set.blockId) {
    return { key: set.blockId, nextLegacyLabel: null, nextLegacySegment: legacySegment };
  }
  const legacyLabel = getLegacyLabel(set);
  let nextLegacySegment = legacySegment;
  if (previousLegacyLabel !== legacyLabel) {
    nextLegacySegment += 1;
  }
  return {
    key: `legacy-${nextLegacySegment}-${legacyLabel}`,
    nextLegacyLabel: legacyLabel,
    nextLegacySegment,
  };
}

function appendRestAndCue(first: ExerciseSet, text: string): string {
  let result = text;
  if (typeof first.intensity === "object" && first.intensity && "restSeconds" in first.intensity) {
    result += ` · rest ${String((first.intensity as Record<string, unknown>).restSeconds)}s`;
  }
  if (first.notes) {
    result += ` · cue: ${first.notes}`;
  }
  return result;
}

function formatStepText(stepNo: number, first: ExerciseSet, units: StructureSummaryUnits): string {
  const label = getLegacyLabel(first);
  const target = formatTargets(first, units);
  let stepText = `S${stepNo} ${label}`;
  if (target) stepText += ` (${target})`;
  return appendRestAndCue(first, stepText);
}

export function serializeWorkoutStructure(
  exerciseSets: ExerciseSet[] | null | undefined,
  units: StructureSummaryUnits,
): string | null {
  if (exerciseSets == null || exerciseSets.length === 0) return null;

  const byBlock = new Map<string, ExerciseSet[]>();
  let previousLegacyLabel: string | null = null;
  let legacySegment = 0;
  for (const set of toPreferenceScaleAll(exerciseSets, units)) {
    const keyInfo = getBlockKey(set, previousLegacyLabel, legacySegment);
    const key = keyInfo.key;
    previousLegacyLabel = keyInfo.nextLegacyLabel;
    legacySegment = keyInfo.nextLegacySegment;
    const list = byBlock.get(key) ?? [];
    list.push(set);
    byBlock.set(key, list);
  }

  const blocks: string[] = [];
  for (const sets of byBlock.values()) {
    sets.sort((a, b) => (a.stepNumber ?? 0) - (b.stepNumber ?? 0) || a.setNumber - b.setNumber);
    const byStep = new Map<number, ExerciseSet[]>();
    let syntheticStep = 0;
    for (const s of sets) {
      let step = s.stepNumber ?? null;
      if (step == null) {
        syntheticStep += 1;
        step = syntheticStep;
      }
      const arr = byStep.get(step) ?? [];
      arr.push(s);
      byStep.set(step, arr);
    }

    const stepTexts: string[] = [];
    for (const [stepNo, stepSets] of byStep.entries()) {
      const first = stepSets[0];
      stepTexts.push(formatStepText(stepNo, first, units));
    }
    blocks.push(stepTexts.join(" → "));
  }

  return blocks.join(" | ");
}

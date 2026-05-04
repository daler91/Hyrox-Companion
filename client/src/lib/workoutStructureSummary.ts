import type { ExerciseSet } from "@shared/schema";

import { getExerciseLabel } from "@/lib/exerciseUtils";

function formatTargets(set: ExerciseSet): string {
  const parts: string[] = [];
  if (set.reps != null) parts.push(`${set.reps} reps`);
  if (set.weight != null) parts.push(`${set.weight}`);
  if (set.distance != null) parts.push(`${set.distance}m`);
  if (set.time != null) parts.push(`${set.time}min`);
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

function formatStepText(stepNo: number, first: ExerciseSet): string {
  const label = getLegacyLabel(first);
  const target = formatTargets(first);
  let stepText = `S${stepNo} ${label}`;
  if (target) stepText += ` (${target})`;
  return appendRestAndCue(first, stepText);
}

export function serializeWorkoutStructure(exerciseSets: ExerciseSet[] | null | undefined): string | null {
  if (exerciseSets == null || exerciseSets.length === 0) return null;

  const byBlock = new Map<string, ExerciseSet[]>();
  let previousLegacyLabel: string | null = null;
  let legacySegment = 0;
  for (const set of exerciseSets) {
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
      stepTexts.push(formatStepText(stepNo, first));
    }
    blocks.push(stepTexts.join(" → "));
  }

  return blocks.join(" | ");
}

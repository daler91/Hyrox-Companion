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

export function serializeWorkoutStructure(exerciseSets: ExerciseSet[] | null | undefined): string | null {
  if (!exerciseSets || exerciseSets.length === 0) return null;

  const byBlock = new Map<string, ExerciseSet[]>();
  for (const set of exerciseSets) {
    const key = set.blockId ?? `legacy-${set.exerciseName}`;
    const list = byBlock.get(key) ?? [];
    list.push(set);
    byBlock.set(key, list);
  }

  const blocks: string[] = [];
  for (const sets of byBlock.values()) {
    sets.sort((a, b) => (a.stepNumber ?? 0) - (b.stepNumber ?? 0) || a.setNumber - b.setNumber);
    const byStep = new Map<number, ExerciseSet[]>();
    for (const s of sets) {
      const step = s.stepNumber ?? 1;
      const arr = byStep.get(step) ?? [];
      arr.push(s);
      byStep.set(step, arr);
    }

    const stepTexts: string[] = [];
    for (const [stepNo, stepSets] of byStep.entries()) {
      const first = stepSets[0];
      const label = getExerciseLabel(first.exerciseName, first.customLabel);
      const target = formatTargets(first);
      const rest = typeof first.intensity === "object" && first.intensity && "restSeconds" in first.intensity
        ? ` · rest ${String((first.intensity as Record<string, unknown>).restSeconds)}s`
        : "";
      const cues = first.notes ? ` · cue: ${first.notes}` : "";
      stepTexts.push(`S${stepNo} ${label}${target ? ` (${target})` : ""}${rest}${cues}`);
    }
    blocks.push(stepTexts.join(" → "));
  }

  return blocks.join(" | ");
}

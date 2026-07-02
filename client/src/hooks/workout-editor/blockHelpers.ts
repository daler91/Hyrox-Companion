import { EXERCISE_DEFINITIONS, type ParsedExercise } from "@shared/schema";
import { getWorkoutDistanceDisplay } from "@shared/unitConversion";
import type { MutableRefObject } from "react";

import type { StructuredExercise } from "@/components/ExerciseInput";

export function makeBlockId(name: string, counterRef: MutableRefObject<number>) {
  counterRef.current += 1;
  return `${name}__${counterRef.current}`;
}

export function getBlockExerciseName(blockId: string): string {
  const parts = blockId.split("__");
  const name = parts.slice(0, -1).join("__") || parts[0];
  if (name.startsWith("custom:")) return "custom";
  return name;
}

export function exerciseToPayload(ex: StructuredExercise | ParsedExercise) {
  return {
    exerciseName: ex.exerciseName,
    customLabel: ex.customLabel,
    category: ex.category,
    confidence: ex.confidence,
    sets: (ex.sets || []).map(s => ({
      setNumber: s.setNumber,
      reps: s.reps,
      weight: s.weight,
      distance: s.distance,
      time: s.time,
      plannedReps: s.plannedReps,
      plannedWeight: s.plannedWeight,
      plannedDistance: s.plannedDistance,
      plannedTime: s.plannedTime,
      blockId: s.blockId,
      stepNumber: s.stepNumber,
      intervalMinute: s.intervalMinute,
      cycleNumber: s.cycleNumber,
      stepRole: s.stepRole,
      groupId: s.groupId,
      notes: s.notes,
    })),
  };
}

function areSetsUniform(sets: NonNullable<StructuredExercise["sets"]>): boolean {
  if (sets.length <= 1) return true;
  const firstSet = sets[0];
  for (let i = 1; i < sets.length; i++) {
    if (sets[i].reps !== firstSet.reps || sets[i].weight !== firstSet.weight) {
      return false;
    }
  }
  return true;
}

function formatExerciseSummary(ex: StructuredExercise, weightUnit: string, distanceUnit: string): string {
  const def = EXERCISE_DEFINITIONS[ex.exerciseName];
  const name = ex.exerciseName === "custom" && ex.customLabel ? ex.customLabel : def?.label || ex.exerciseName;
  const sets = ex.sets || [];

  if (sets.length === 0) {
    return `${name}: completed`;
  }

  const firstSet = sets[0];
  const allSame = areSetsUniform(sets);

  const parts: string[] = [];
  if (allSame && sets.length > 1 && firstSet.reps) {
    parts.push(`${sets.length}x${firstSet.reps}`);
  } else if (firstSet.reps) {
    parts.push(`${sets.length > 1 ? sets.length + " sets, " : ""}${firstSet.reps} reps`);
  } else if (sets.length > 1) {
    parts.push(`${sets.length} sets`);
  }

  if (allSame && firstSet.weight) parts.push(`${firstSet.weight}${weightUnit}`);
  if (firstSet.distance) parts.push(getWorkoutDistanceDisplay(firstSet.distance, distanceUnit).text);
  if (firstSet.time) parts.push(`${firstSet.time}min`);

  return `${name}: ${parts.join(", ") || "completed"}`;
}

export function generateSummary(exercises: StructuredExercise[], weightUnit: string, distanceUnit: string): string {
  const hasStructuredHints = exercises.some((ex) => (ex.sets || []).some((set) => Boolean(set.notes)));
  if (!hasStructuredHints) {
    const summaries: string[] = [];
    for (const ex of exercises) summaries.push(formatExerciseSummary(ex, weightUnit, distanceUnit));
    return summaries.join("; ");
  }

  const blocks: string[] = [];
  for (const ex of exercises) {
    const headline = formatExerciseSummary(ex, weightUnit, distanceUnit);
    const steps = (ex.sets || []).map((set, idx) => {
      const stepLabel = `S${idx + 1}`;
      if (!set.notes) return stepLabel;
      return `${stepLabel}(cue: ${set.notes})`;
    });
    blocks.push(steps.length > 0 ? `${headline} [${steps.join(" -> ")}]` : headline);
  }
  return blocks.join("; ");
}

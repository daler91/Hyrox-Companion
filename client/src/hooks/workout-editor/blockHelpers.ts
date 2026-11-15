import type { ParsedExercise } from "@shared/schema";
import type { MutableRefObject } from "react";

import type { StructuredExercise } from "@/lib/structuredExercise";

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

export { generateSummary } from "@shared/workoutSummary";

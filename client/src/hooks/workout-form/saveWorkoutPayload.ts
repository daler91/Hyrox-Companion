import type { ParsedExercise } from "@shared/schema";

import type { StructuredExercise } from "@/components/ExerciseInput";
import { exerciseToPayload, generateSummary } from "@/hooks/useWorkoutEditor";
import { getMissingFieldWarnings } from "@/lib/exerciseWarnings";

import type { SaveWorkoutInput } from "./types";

interface BuildWorkoutSavePayloadInput {
  readonly title: string;
  readonly date: string;
  readonly freeText: string;
  readonly notes: string;
  readonly rpe: number | null;
  readonly planDayId?: string | null;
  readonly exerciseBlocks: string[];
  readonly exerciseData: Record<string, StructuredExercise>;
  readonly weightLabel: string;
  readonly distanceUnit: string;
}

type SavePayloadResult =
  | {
      readonly ok: true;
      readonly payload: SaveWorkoutInput;
      readonly warnings: string[];
    }
  | {
      readonly ok: false;
      readonly description: string;
    };

function structuredExercises(
  exerciseBlocks: readonly string[],
  exerciseData: Readonly<Record<string, StructuredExercise>>,
): StructuredExercise[] {
  return exerciseBlocks.map((id) => exerciseData[id]).filter(Boolean);
}

export function buildWorkoutSavePayload({
  title,
  date,
  freeText,
  notes,
  rpe,
  planDayId,
  exerciseBlocks,
  exerciseData,
  weightLabel,
  distanceUnit,
}: BuildWorkoutSavePayloadInput): SavePayloadResult {
  const effectiveTitle = title.trim() || "Workout";
  const hasStructured = exerciseBlocks.length > 0;

  if (!hasStructured) {
    if (!freeText.trim()) {
      return {
        ok: false,
        description: "Please add an exercise or describe your workout.",
      };
    }
    return {
      ok: true,
      warnings: [],
      payload: {
        title: effectiveTitle,
        date,
        focus: effectiveTitle,
        mainWorkout: freeText,
        notes: notes || null,
        rpe: rpe || null,
        ...(planDayId ? { planDayId } : {}),
      },
    };
  }

  const exercises = structuredExercises(exerciseBlocks, exerciseData);
  if (exercises.length === 0 && !freeText.trim()) {
    return {
      ok: false,
      description: "Please add at least one exercise or describe your workout.",
    };
  }

  const warnings = [...new Set(exercises.flatMap((exercise) => getMissingFieldWarnings(exercise)))];
  const mainWorkout = freeText.trim()
    ? freeText
    : generateSummary(exercises, weightLabel, distanceUnit);

  return {
    ok: true,
    warnings,
    payload: {
      title: effectiveTitle,
      date,
      focus: effectiveTitle,
      mainWorkout,
      notes: notes || null,
      rpe: rpe || null,
      ...(planDayId ? { planDayId } : {}),
      exercises: exercises.map(exerciseToPayload) as ParsedExercise[],
    },
  };
}

import { lintWorkoutStructure, type ParsedExercise, type StructureBlockInput, type StructureLintIssue } from "@shared/schema";

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
  readonly structureBlocks: StructureBlockInput[];
  readonly weightLabel: string;
  readonly distanceUnit: string;
}

type SavePayloadResult =
  | {
      readonly ok: true;
      readonly payload: SaveWorkoutInput;
      readonly warnings: string[];
      readonly lintIssues: StructureLintIssue[];
      readonly structureCompletenessScore: number;
    }
  | {
      readonly ok: false;
      readonly description: string;
    };

function structuredExercises(
  exerciseBlocks: readonly string[],
  exerciseData: Readonly<Record<string, StructuredExercise>>,
): StructuredExercise[] {
  const result: StructuredExercise[] = [];
  // ⚡ Bolt Performance Optimization:
  // Replaced chained `.map(...).filter(...)` with a single for...of loop.
  // This avoids an intermediate array allocation and a double O(N) traversal.
  for (const id of exerciseBlocks) {
    const ex = exerciseData[id];
    if (ex) {
      result.push(ex);
    }
  }
  return result;
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
  structureBlocks,
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
      lintIssues: [],
      structureCompletenessScore: 100,
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

  const missingFieldWarnings = [...new Set(exercises.flatMap((exercise) => getMissingFieldWarnings(exercise)))];
  const lint = lintWorkoutStructure(undefined, exercises.map(exerciseToPayload) as ParsedExercise[]);
  const lintIssues: StructureLintIssue[] = [
    ...lint.warnings,
    ...missingFieldWarnings.map((message) => ({
      severity: "warning" as const,
      code: "MISSING_FIELD",
      message,
      fixGuidance: "Fill the missing critical field for clearer tracking.",
    })),
  ];
  const warnings = lintIssues.map((issue) => issue.message);
  if (lint.schemaErrors.length > 0) {
    return {
      ok: false,
      description: lint.schemaErrors[0]?.message ?? "Structured workout has validation errors.",
    };
  }
  const mainWorkout = freeText.trim()
    ? freeText
    : generateSummary(exercises, weightLabel, distanceUnit);

  return {
    ok: true,
    warnings,
    lintIssues,
    structureCompletenessScore: lint.structureCompletenessScore,
    payload: {
      title: effectiveTitle,
      date,
      focus: effectiveTitle,
      mainWorkout,
      notes: notes || null,
      rpe: rpe || null,
      ...(planDayId ? { planDayId } : {}),
      exercises: exercises.map(exerciseToPayload) as ParsedExercise[],
      structureBlocks,
    },
  };
}

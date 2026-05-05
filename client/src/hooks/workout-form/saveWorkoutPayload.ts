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

function normalizeLegacyExercise(exercise: StructuredExercise): StructuredExercise {
  if (exercise.exerciseName !== "emom") return exercise;
  return {
    ...exercise,
    exerciseName: "custom",
    customLabel: exercise.customLabel || "EMOM",
  };
}

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
      result.push(normalizeLegacyExercise(ex));
    }
  }
  return result;
}

function toStructureBlocks(exercises: readonly StructuredExercise[]): StructureBlockInput[] {
  const blocks: StructureBlockInput[] = [];
  exercises.forEach((exercise, idx) => {
    if (!exercise.structure || exercise.structure.steps.length === 0) return;
    const steps = exercise.structure.steps.map((step, stepIdx) => ({
      stepNumber: stepIdx + 1,
      stepType: step.type,
      exerciseName: step.type === "rest" ? undefined : (step.exercise ?? exercise.customLabel ?? exercise.exerciseName),
      minuteIndex: exercise.structure?.blockType === "emom" ? stepIdx + 1 : undefined,
      durationSeconds: step.durationSeconds,
      instructions: step.target,
    }));
    blocks.push({
      sectionType: exercise.structure.section,
      formatType: exercise.structure.blockType,
      durationMinutes: exercise.structure.blockType === "emom" ? exercise.structure.emomDurationMinutes ?? steps.length : undefined,
      sequenceOrder: idx,
      sortOrder: idx,
      steps,
    });
  });
  return blocks;
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
  structureBlocks: incomingStructureBlocks = [],
  weightLabel,
  distanceUnit,
}: BuildWorkoutSavePayloadInput): SavePayloadResult {
  const effectiveTitle = title.trim() || "Workout";
  const hasStructured = exerciseBlocks.length > 0 || incomingStructureBlocks.length > 0;

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
  const hasStructuredRows = exercises.length > 0 || incomingStructureBlocks.length > 0;

  if (freeText.trim() && !hasStructuredRows) {
    return {
      ok: false,
      description: "Please add at least one structured exercise row or run Parse before saving.",
    };
  }

  if (exercises.length === 0 && incomingStructureBlocks.length === 0 && !freeText.trim()) {
    return {
      ok: false,
      description: "Please add at least one exercise or describe your workout.",
    };
  }

  const missingFieldWarnings = [...new Set(exercises.flatMap((exercise) => getMissingFieldWarnings(exercise)))];
  const structureBlocks = toStructureBlocks(exercises);
  const lint = lintWorkoutStructure(structureBlocks, exercises.map(exerciseToPayload) as ParsedExercise[]);
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
      ...(incomingStructureBlocks.length > 0 ? { structureBlocks: incomingStructureBlocks } : {}),
    },
  };
}

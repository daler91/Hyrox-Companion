import { lintWorkoutStructure, type ParsedExercise, type StructureBlockInput, type StructureLintIssue } from "@shared/schema";

import type { StructuredExercise } from "@/components/ExerciseInput";
import { configToStructureBlock } from "@/components/workout-structure";
import { exerciseToPayload, generateSummary } from "@/hooks/useWorkoutEditor";
import { getMissingFieldWarnings } from "@/lib/exerciseWarnings";
import { normalizeDurationMinutes } from "@/lib/workoutDuration";

import type { SaveWorkoutInput } from "./types";

interface BuildWorkoutSavePayloadInput {
  readonly title: string;
  readonly date: string;
  readonly freeText: string;
  readonly notes: string;
  readonly rpe: number | null;
  readonly durationMinutes?: string;
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

function linkSetToStep(
  set: StructuredExercise["sets"][number],
  blockId: string,
  step: StructureBlockInput["steps"][number],
): StructuredExercise["sets"][number] {
  return {
    ...set,
    blockId,
    stepNumber: step.stepNumber,
    intervalMinute: step.minuteIndex ?? undefined,
    stepRole: step.stepRole ?? step.stepType ?? "work",
    groupId: step.groupId ?? undefined,
  };
}

function structureBlocksFromExerciseConfigs(exercises: readonly StructuredExercise[]): {
  readonly exercises: StructuredExercise[];
  readonly structureBlocks: StructureBlockInput[];
} {
  const blocks: StructureBlockInput[] = [];
  const linkedExercises = exercises.map((exercise, idx) => {
    if (!exercise.structure || exercise.structure.steps.length === 0) return exercise;
    const id = exercise.structure.id ?? crypto.randomUUID();
    const block = configToStructureBlock({ ...exercise.structure, id }, {
        sequenceOrder: idx,
        sortOrder: idx,
        fallbackExerciseName: exercise.customLabel ?? exercise.exerciseName,
      });
    blocks.push(block);
    if (exercise.sets.some((set) => set.blockId)) return exercise;
    const workSteps = block.steps.filter((step) => (step.stepType ?? "work") === "work");
    if (workSteps.length === 0) return exercise;
    return {
      ...exercise,
      sets: exercise.sets.map((set, setIndex) => linkSetToStep(set, id, workSteps[setIndex % workSteps.length])),
    };
  });
  return { exercises: linkedExercises, structureBlocks: blocks };
}

function ensureBlockIds(blocks: readonly StructureBlockInput[]): StructureBlockInput[] {
  return blocks.map((block) => (block.id ? block : { ...block, id: crypto.randomUUID() }));
}

function clearBlockLink(set: StructuredExercise["sets"][number]): StructuredExercise["sets"][number] {
  return {
    ...set,
    blockId: null,
    stepNumber: null,
    intervalMinute: null,
    cycleNumber: null,
    stepRole: null,
    groupId: null,
  };
}

function clearLinksToMissingBlocks(
  exercises: readonly StructuredExercise[],
  blocks: readonly StructureBlockInput[],
): StructuredExercise[] {
  // ⚡ Bolt Performance Optimization:
  // Replaced chained `.map(...).filter(...)` with a single loop.
  // This avoids intermediate array allocations and double O(N) traversals.
  const validBlockIds = new Set<string>();
  for (const block of blocks) {
    if (block.id) validBlockIds.add(block.id);
  }
  return exercises.map((exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set) => {
      if (!set.blockId || validBlockIds.has(set.blockId)) return set;
      return clearBlockLink(set);
    }),
  }));
}

function linkedSetTargets(set: StructuredExercise["sets"][number]): NonNullable<StructureBlockInput["steps"][number]["targets"]> | undefined {
  const targets: Record<string, unknown> = {};
  const reps = set.plannedReps ?? set.reps;
  const weight = set.plannedWeight ?? set.weight;
  const distance = set.plannedDistance ?? set.distance;
  const time = set.plannedTime ?? set.time;
  if (reps != null) targets.targetReps = reps;
  if (weight != null) targets.targetWeight = weight;
  if (distance != null) targets.targetDistance = distance;
  if (time != null) targets.targetTime = time;
  return Object.keys(targets).length > 0
    ? (targets)
    : undefined;
}

function linkedRowsByStep(exercises: readonly StructuredExercise[]) {
  const rows = new Map<string, { exercise: StructuredExercise; set: StructuredExercise["sets"][number] }>();
  for (const exercise of exercises) {
    for (const set of exercise.sets) {
      if (!set.blockId || set.stepNumber == null) continue;
      const key = `${set.blockId}:${set.stepNumber}`;
      if (!rows.has(key)) rows.set(key, { exercise, set });
    }
  }
  return rows;
}

function enrichStructureBlocksFromRows(
  blocks: readonly StructureBlockInput[],
  exercises: readonly StructuredExercise[],
): StructureBlockInput[] {
  const linkedRows = linkedRowsByStep(exercises);
  return blocks.map((block) => ({
    ...block,
    steps: block.steps.map((step) => {
      if ((step.stepType ?? "work") !== "work" || !block.id) return step;
      const linked = linkedRows.get(`${block.id}:${step.stepNumber}`);
      if (!linked) return step;
      return {
        ...step,
        exerciseName: linked.exercise.exerciseName,
        category: linked.exercise.category,
        customLabel: linked.exercise.customLabel ?? null,
        stepRole: step.stepRole ?? linked.set.stepRole ?? "work",
        targets: step.targets ?? linkedSetTargets(linked.set),
      };
    }),
  }));
}

export function buildWorkoutSavePayload({
  title,
  date,
  freeText,
  notes,
  rpe,
  durationMinutes,
  planDayId,
  exerciseBlocks,
  exerciseData,
  structureBlocks: incomingStructureBlocks = [],
  weightLabel,
  distanceUnit,
}: BuildWorkoutSavePayloadInput): SavePayloadResult {
  const effectiveTitle = title.trim() || "Workout";
  const hasStructured = exerciseBlocks.length > 0 || incomingStructureBlocks.length > 0;
  const normalizedDuration = normalizeDurationMinutes(durationMinutes);

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
        ...(normalizedDuration != null ? { duration: normalizedDuration } : {}),
        ...(planDayId ? { planDayId } : {}),
      },
    };
  }

  const blocksWithIds = ensureBlockIds(incomingStructureBlocks);
  const exerciseStructure = structureBlocksFromExerciseConfigs(
    structuredExercises(exerciseBlocks, exerciseData),
  );
  const allStructureBlocks = [...blocksWithIds, ...exerciseStructure.structureBlocks];
  const exercises = clearLinksToMissingBlocks(exerciseStructure.exercises, allStructureBlocks);
  const hasStructuredRows = exercises.length > 0 || blocksWithIds.length > 0;

  if (freeText.trim() && !hasStructuredRows) {
    return {
      ok: false,
      description: "Please add at least one structured exercise row or run Parse before saving.",
    };
  }

  if (exercises.length === 0 && blocksWithIds.length === 0 && !freeText.trim()) {
    return {
      ok: false,
      description: "Please add at least one exercise or describe your workout.",
    };
  }

  const missingFieldWarnings = [...new Set(exercises.flatMap((exercise) => getMissingFieldWarnings(exercise)))];
  const structureBlocks = enrichStructureBlocksFromRows(allStructureBlocks, exercises);
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
      ...(normalizedDuration != null ? { duration: normalizedDuration } : {}),
      ...(planDayId ? { planDayId } : {}),
      exercises: exercises.map(exerciseToPayload) as ParsedExercise[],
      ...(structureBlocks.length > 0 ? { structureBlocks } : {}),
    },
  };
}

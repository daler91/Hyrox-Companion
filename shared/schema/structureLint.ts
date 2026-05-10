import type { ParsedExercise, StructureBlockInput } from "./types";

export type StructureLintSeverity = "error" | "warning" | "info";

export interface StructureLintIssue {
  severity: StructureLintSeverity;
  code: string;
  message: string;
  fixGuidance: string;
}

export interface StructureLintResult {
  issues: StructureLintIssue[];
  schemaErrors: StructureLintIssue[];
  warnings: StructureLintIssue[];
  infos: StructureLintIssue[];
  structureCompletenessScore: number;
}

function hasTarget(step: NonNullable<StructureBlockInput["steps"]>[number], key: string): boolean {
  if (typeof step.targets !== "object" || step.targets === null) return false;
  const alias: Record<string, string> = {
    reps: "targetReps",
    time: "targetTime",
    distance: "targetDistance",
    weight: "targetWeight",
  };
  return step.targets[key] != null || step.targets[alias[key]] != null;
}

function structureIssue(
  severity: StructureLintSeverity,
  code: string,
  message: string,
  fixGuidance: string,
): StructureLintIssue {
  return { severity, code, message, fixGuidance };
}

function hasPerSetReps(exercise: ParsedExercise): boolean {
  return exercise.sets?.some((s) => s.reps != null) ?? false;
}

function exerciseIssues(exercises: ParsedExercise[]): StructureLintIssue[] {
  const issues: StructureLintIssue[] = [];
  for (const exercise of exercises) {
    if (exercise.repMode !== "per_side" || exercise.reps == null || !hasPerSetReps(exercise)) continue;
    issues.push(structureIssue(
      "warning",
      "AMBIGUOUS_REPS_SCOPE",
      `${exercise.exerciseName} has both top-level reps and set reps while repMode is per_side.`,
      "Keep either total reps or per-set reps, then align repMode to match.",
    ));
  }
  return issues;
}

function blockFormatIssues(block: StructureBlockInput, format: string): StructureLintIssue[] {
  const issues: StructureLintIssue[] = [];
  if (format === "amrap" && block.rounds != null) {
    issues.push(structureIssue(
      "error",
      "INCOMPATIBLE_FORMAT_PARAMS",
      "AMRAP cannot include fixed rounds.",
      "Remove rounds or change format type.",
    ));
  }
  if (format === "amrap" && block.durationSeconds == null && block.durationMinutes == null && block.timeCapMinutes == null) {
    issues.push(structureIssue(
      "error",
      "MISSING_REQUIRED_TARGET_BY_FORMAT",
      "AMRAP blocks require a time cap or duration.",
      "Set a time cap or duration on the block.",
    ));
  }
  if (format === "rounds" && block.roundCount == null && block.rounds == null) {
    issues.push(structureIssue(
      "error",
      "MISSING_REQUIRED_TARGET_BY_FORMAT",
      "Rounds blocks require a round count.",
      "Set the number of prescribed rounds.",
    ));
  }
  if (format === "for_time" && block.durationSeconds == null && block.timeCapMinutes == null) {
    issues.push(structureIssue(
      "error",
      "MISSING_REQUIRED_TARGET_BY_FORMAT",
      "for_time blocks require durationSeconds cap.",
      "Set a duration cap in seconds.",
    ));
  }
  if (format === "interval" && (block.workSeconds == null || block.restSeconds == null) && (block.workIntervalSec == null || block.restIntervalSec == null)) {
    issues.push(structureIssue(
      "error",
      "MISSING_REQUIRED_TARGET_BY_FORMAT",
      "interval blocks require both workSeconds and restSeconds.",
      "Provide work and rest seconds on the block.",
    ));
  }
  return issues;
}

function isRestStep(step: NonNullable<StructureBlockInput["steps"]>[number]): boolean {
  return (step.stepRole ?? step.stepType ?? "").toLowerCase() === "rest";
}

function restScopeIssues(block: StructureBlockInput): StructureLintIssue[] {
  const hasRestStep = block.steps.some(isRestStep);
  if (!hasRestStep || block.restSeconds == null) return [];
  return [structureIssue(
    "warning",
    "REST_SCOPE_CONFLICT",
    "Block has restSeconds and explicit rest steps; rest scope may be duplicated.",
    "Use block-level rest OR rest steps, not both.",
  )];
}

function isMissingForTimeTarget(step: NonNullable<StructureBlockInput["steps"]>[number]): boolean {
  return !hasTarget(step, "distance") && !hasTarget(step, "reps") && !hasTarget(step, "time");
}

function stepTargetIssues(block: StructureBlockInput, format: string): StructureLintIssue[] {
  if (format !== "for_time") return [];
  const issues: StructureLintIssue[] = [];
  for (const step of block.steps) {
    if (!isMissingForTimeTarget(step)) continue;
    issues.push(structureIssue(
      "info",
      "MISSING_STEP_TARGET",
      `Step ${step.stepNumber} has no explicit target.`,
      "Add a reps, distance, or time target for clearer execution.",
    ));
  }
  return issues;
}

function blockIssues(block: StructureBlockInput): StructureLintIssue[] {
  const format = block.formatType.toLowerCase();
  return [
    ...blockFormatIssues(block, format),
    ...restScopeIssues(block),
    ...stepTargetIssues(block, format),
  ];
}

function isComplexBlock(block: StructureBlockInput): boolean {
  return block.formatType === "emom" || block.formatType === "amrap" || block.formatType === "rounds";
}

function requiresLinkedExerciseRow(step: StructureBlockInput["steps"][number]): boolean {
  const role = (step.stepRole ?? step.stepType ?? "work").toLowerCase();
  return role === "work";
}

function linkedExerciseStepKeys(exercises: ParsedExercise[]): Set<string> {
  const keys = new Set<string>();
  for (const exercise of exercises) {
    for (const set of exercise.sets ?? []) {
      if (!set.blockId || set.stepNumber == null) continue;
      keys.add(`${set.blockId}:${set.stepNumber}`);
    }
  }
  return keys;
}

function blockLinkIssues(blocks: StructureBlockInput[], exercises: ParsedExercise[]): StructureLintIssue[] {
  if (exercises.length === 0) return [];
  const linkedKeys = linkedExerciseStepKeys(exercises);
  const issues: StructureLintIssue[] = [];
  for (const block of blocks) {
    if (!isComplexBlock(block)) continue;
    if (!block.id) {
      issues.push(structureIssue(
        "error",
        "MISSING_BLOCK_ID",
        `${block.formatType.toUpperCase()} blocks require a stable id for exercise row links.`,
        "Save the block with an id and link exercise rows to its steps.",
      ));
      continue;
    }
    for (const step of block.steps) {
      if (!requiresLinkedExerciseRow(step)) continue;
      const key = `${block.id}:${step.stepNumber}`;
      if (linkedKeys.has(key)) continue;
      issues.push(structureIssue(
        "error",
        "MISSING_LINKED_EXERCISE_ROW",
        `${block.formatType.toUpperCase()} step ${step.stepNumber} must be linked to an exercise row.`,
        "Assign an exercise table row to this block step.",
      ));
    }
  }
  return issues;
}

function buildLintResult(issues: StructureLintIssue[], total: number): StructureLintResult {
  const schemaErrors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const infos = issues.filter((i) => i.severity === "info");
  const penalty = schemaErrors.length * 30 + warnings.length * 10 + infos.length * 3;
  const base = total === 0 ? 100 : 100 - penalty;

  return {
    issues,
    schemaErrors,
    warnings,
    infos,
    structureCompletenessScore: Math.max(0, Math.min(100, base)),
  };
}

export function lintWorkoutStructure(structureBlocks?: StructureBlockInput[] | null, exercises?: ParsedExercise[] | null): StructureLintResult {
  const blocks = structureBlocks ?? [];
  const exList = exercises ?? [];
  const issues = [
    ...exerciseIssues(exList),
    ...blocks.flatMap(blockIssues),
    ...blockLinkIssues(blocks, exList),
  ];
  return buildLintResult(issues, blocks.length + exList.length);
}

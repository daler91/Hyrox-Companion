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
  ];
  return buildLintResult(issues, blocks.length + exList.length);
}

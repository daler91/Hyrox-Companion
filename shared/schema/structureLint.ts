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

export function lintWorkoutStructure(structureBlocks?: StructureBlockInput[] | null, exercises?: ParsedExercise[] | null): StructureLintResult {
  const issues: StructureLintIssue[] = [];
  const exList = exercises ?? [];
  for (const exercise of exList) {
    if (exercise.repMode === "per_side" && exercise.reps != null && exercise.sets?.some((s) => s.reps != null)) {
      issues.push({
        severity: "warning",
        code: "AMBIGUOUS_REPS_SCOPE",
        message: `${exercise.exerciseName} has both top-level reps and set reps while repMode is per_side.`,
        fixGuidance: "Keep either total reps or per-set reps, then align repMode to match.",
      });
    }
  }

  for (const block of structureBlocks ?? []) {
    const format = block.formatType.toLowerCase();
    if (format === "amrap" && block.rounds != null) {
      issues.push({
        severity: "error",
        code: "INCOMPATIBLE_FORMAT_PARAMS",
        message: "AMRAP cannot include fixed rounds.",
        fixGuidance: "Remove rounds or change format type.",
      });
    }
    if (format === "for_time" && block.durationSeconds == null && block.timeCapMinutes == null) {
      issues.push({
        severity: "error",
        code: "MISSING_REQUIRED_TARGET_BY_FORMAT",
        message: "for_time blocks require durationSeconds cap.",
        fixGuidance: "Set a duration cap in seconds.",
      });
    }
    if (format === "interval" && (block.workSeconds == null || block.restSeconds == null) && (block.workIntervalSec == null || block.restIntervalSec == null)) {
      issues.push({
        severity: "error",
        code: "MISSING_REQUIRED_TARGET_BY_FORMAT",
        message: "interval blocks require both workSeconds and restSeconds.",
        fixGuidance: "Provide work and rest seconds on the block.",
      });
    }

    const hasRestStep = block.steps.some((s) => (s.stepRole ?? s.stepType ?? "").toLowerCase() === "rest");
    if (hasRestStep && block.restSeconds != null) {
      issues.push({
        severity: "warning",
        code: "REST_SCOPE_CONFLICT",
        message: "Block has restSeconds and explicit rest steps; rest scope may be duplicated.",
        fixGuidance: "Use block-level rest OR rest steps, not both.",
      });
    }

    for (const step of block.steps) {
      if (format === "for_time" && !hasTarget(step, "distance") && !hasTarget(step, "reps") && !hasTarget(step, "time")) {
        issues.push({
          severity: "info",
          code: "MISSING_STEP_TARGET",
          message: `Step ${step.stepNumber} has no explicit target.`,
          fixGuidance: "Add a reps, distance, or time target for clearer execution.",
        });
      }
    }
  }

  const schemaErrors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const infos = issues.filter((i) => i.severity === "info");
  const total = (structureBlocks?.length ?? 0) + exList.length;
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

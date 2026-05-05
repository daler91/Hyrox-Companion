import type { StructureBlockInput } from "@shared/schema";

import type { WorkoutStep,WorkoutStructureConfig } from "./types";

interface ConfigToBlockOptions {
  readonly sequenceOrder?: number;
  readonly sortOrder?: number;
  readonly fallbackExerciseName?: string;
}

export function configToStructureBlock(
  config: WorkoutStructureConfig,
  options: ConfigToBlockOptions = {},
): StructureBlockInput {
  const { sequenceOrder, sortOrder, fallbackExerciseName } = options;
  const steps = config.steps.map((step, stepIdx) => ({
    stepNumber: stepIdx + 1,
    stepType: step.type,
    exerciseName: step.type === "rest" ? undefined : (step.exercise ?? fallbackExerciseName),
    minuteIndex: config.blockType === "emom" ? stepIdx + 1 : undefined,
    durationSeconds: step.durationSeconds,
    instructions: step.target,
  }));
  return {
    sectionType: config.section,
    formatType: config.blockType,
    durationMinutes:
      config.blockType === "emom" ? config.emomDurationMinutes ?? steps.length : undefined,
    sequenceOrder,
    sortOrder,
    steps,
  };
}

export function structureBlockToConfig(block: StructureBlockInput): WorkoutStructureConfig {
  const fallbackSection: WorkoutStructureConfig["section"] =
    block.sectionType === "activation" ? "warmup" : block.sectionType;
  const blockType: WorkoutStructureConfig["blockType"] =
    block.formatType === "quality" ? "steady" : block.formatType;
  const steps: WorkoutStep[] = block.steps.map((step) => ({
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `step-${step.stepNumber}-${Math.random().toString(36).slice(2, 8)}`,
    type: step.stepType ?? "work",
    exercise: step.exerciseName ?? undefined,
    target: step.customLabel ?? undefined,
  }));
  return {
    section: fallbackSection,
    blockType,
    emomDurationMinutes:
      block.formatType === "emom" ? block.durationMinutes ?? undefined : undefined,
    emomAlternating: false,
    steps,
  };
}

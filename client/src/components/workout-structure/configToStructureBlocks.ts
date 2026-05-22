import type { StructureBlockInput } from "@shared/schema";

import type { WorkoutStep,WorkoutStructureConfig } from "./types";

interface ConfigToBlockOptions {
  readonly sequenceOrder?: number;
  readonly sortOrder?: number;
  readonly fallbackExerciseName?: string;
}

function stepTargetsForConfig(step: WorkoutStep): NonNullable<StructureBlockInput["steps"][number]["targets"]> | undefined {
  const targets: Record<string, unknown> = {};
  if (step.target) targets.instructions = step.target;
  if (typeof step.durationSeconds === "number" && Number.isFinite(step.durationSeconds)) {
    targets.durationSeconds = step.durationSeconds;
  }
  return Object.keys(targets).length > 0
    ? (targets)
    : undefined;
}

function durationSecondsFromTargets(targets: StructureBlockInput["steps"][number]["targets"]): number | undefined {
  if (!targets || typeof targets !== "object") return undefined;
  const raw = (targets as Record<string, unknown>).durationSeconds;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

export function configToStructureBlock(
  config: WorkoutStructureConfig,
  options: ConfigToBlockOptions = {},
): StructureBlockInput {
  const { sequenceOrder, sortOrder, fallbackExerciseName } = options;
  const steps = config.steps.map((step, stepIdx) => ({
    stepNumber: stepIdx + 1,
    stepType: step.type,
    exerciseName: step.type === "work" ? (step.exercise ?? fallbackExerciseName) : undefined,
    minuteIndex: config.blockType === "emom" ? stepIdx + 1 : undefined,
    targets: stepTargetsForConfig(step),
  }));
  return {
    ...(config.id ? { id: config.id } : {}),
    sectionType: config.section,
    formatType: config.blockType,
    durationMinutes:
      config.blockType === "emom" ? config.emomDurationMinutes ?? steps.length : undefined,
    timeCapMinutes: config.blockType === "amrap" ? config.timeCapMinutes ?? 10 : undefined,
    roundCount: config.blockType === "rounds" ? config.roundCount ?? 3 : undefined,
    score: config.score ?? undefined,
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
    id: crypto.randomUUID(),
    type: step.stepType ?? "work",
    exercise: step.exerciseName ?? undefined,
    target: typeof step.targets?.instructions === "string" ? step.targets.instructions : undefined,
    durationSeconds: durationSecondsFromTargets(step.targets),
  }));
  return {
    id: block.id,
    section: fallbackSection,
    blockType,
    emomDurationMinutes:
      block.formatType === "emom" ? block.durationMinutes ?? undefined : undefined,
    timeCapMinutes: block.formatType === "amrap" ? block.timeCapMinutes ?? block.durationMinutes ?? undefined : undefined,
    roundCount: block.formatType === "rounds" ? block.roundCount ?? block.rounds ?? undefined : undefined,
    steps,
    score: block.score ?? null,
  };
}

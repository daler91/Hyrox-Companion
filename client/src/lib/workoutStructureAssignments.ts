import type { StructureBlockInput } from "@shared/schema";

import type { PatchExerciseSetPayload } from "@/lib/api";
import type { GroupedExercise } from "@/lib/exerciseUtils";

export interface BlockAssignmentOption {
  readonly value: string;
  readonly label: string;
  readonly blockId: string;
  readonly stepNumber: number;
  readonly intervalMinute: number | null;
  readonly stepRole: string | null;
  readonly groupId: string | null;
}

export const UNASSIGNED_BLOCK_VALUE = "none";

function isAssignableBlock(block: StructureBlockInput): boolean {
  return block.formatType === "emom" || block.formatType === "amrap" || block.formatType === "rounds";
}

function isAssignableStep(step: StructureBlockInput["steps"][number]): boolean {
  return (step.stepType ?? "work") === "work";
}

export function blockStepValue(blockId: string, stepNumber: number): string {
  return `${blockId}:${stepNumber}`;
}

function blockLabel(block: StructureBlockInput, blockIndex: number): string {
  const type = block.formatType.toUpperCase();
  return `${type} ${blockIndex + 1}`;
}

function stepLabel(block: StructureBlockInput, step: StructureBlockInput["steps"][number], blockIndex: number): string {
  const prefix = blockLabel(block, blockIndex);
  if (block.formatType === "emom") {
    return `${prefix} - min ${step.minuteIndex ?? step.stepNumber}`;
  }
  return `${prefix} - step ${step.stepNumber}`;
}

export function buildBlockAssignmentOptions(blocks: readonly StructureBlockInput[]): BlockAssignmentOption[] {
  const options: BlockAssignmentOption[] = [];
  blocks.forEach((block, blockIndex) => {
    if (!block.id || !isAssignableBlock(block)) return;
    for (const step of block.steps) {
      if (!isAssignableStep(step)) continue;
      options.push({
        value: blockStepValue(block.id, step.stepNumber),
        label: stepLabel(block, step, blockIndex),
        blockId: block.id,
        stepNumber: step.stepNumber,
        intervalMinute: step.minuteIndex ?? null,
        stepRole: step.stepRole ?? step.stepType ?? "work",
        groupId: step.groupId ?? null,
      });
    }
  });
  return options;
}

export function assignmentValueForGroup(group: GroupedExercise, options: readonly BlockAssignmentOption[]): string {
  const first = group.sets[0];
  if (!first?.blockId || first.stepNumber == null) return UNASSIGNED_BLOCK_VALUE;
  const value = blockStepValue(first.blockId, first.stepNumber);
  return options.some((option) => option.value === value) ? value : UNASSIGNED_BLOCK_VALUE;
}

export function assignmentPatchForValue(
  value: string,
  options: readonly BlockAssignmentOption[],
): PatchExerciseSetPayload {
  if (value === UNASSIGNED_BLOCK_VALUE) {
    return {
      blockId: null,
      stepNumber: null,
      intervalMinute: null,
      cycleNumber: null,
      stepRole: null,
      groupId: null,
    };
  }
  const option = options.find((candidate) => candidate.value === value);
  if (!option) return {};
  return {
    blockId: option.blockId,
    stepNumber: option.stepNumber,
    intervalMinute: option.intervalMinute,
    cycleNumber: null,
    stepRole: option.stepRole,
    groupId: option.groupId,
  };
}

export function assignmentPatchForStep(
  block: StructureBlockInput,
  step: StructureBlockInput["steps"][number],
): PatchExerciseSetPayload {
  if (!block.id) return {};
  return {
    blockId: block.id,
    stepNumber: step.stepNumber,
    intervalMinute: step.minuteIndex ?? null,
    cycleNumber: null,
    stepRole: step.stepRole ?? step.stepType ?? "work",
    groupId: step.groupId ?? null,
  };
}

export function isUnassignedGroup(group: GroupedExercise): boolean {
  const first = group.sets[0];
  return !first?.blockId || first.stepNumber == null;
}

export function groupMatchesBlockStep(
  group: GroupedExercise,
  blockId: string,
  stepNumber: number,
): boolean {
  return group.sets.some((set) => set.blockId === blockId && set.stepNumber === stepNumber);
}

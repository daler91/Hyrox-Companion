import { EXERCISE_DEFINITIONS, normalizeExerciseName, type ParsedExercise, type StructureBlockInput } from "@shared/schema";

import type { ParseWorkoutStructureResponse } from "@/lib/api";

function isWorkStructureStep(step: StructureBlockInput["steps"][number]): boolean {
  return (step.stepType ?? "work") === "work";
}

function targetNumber(
  targets: StructureBlockInput["steps"][number]["targets"],
  ...keys: string[]
): number | undefined {
  if (!targets || typeof targets !== "object") return undefined;
  for (const key of keys) {
    const value = (targets as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function ensureStructureBlockIds(blocks: readonly StructureBlockInput[]): StructureBlockInput[] {
  return blocks.map((block) => (block.id ? block : { ...block, id: crypto.randomUUID() }));
}

function exerciseKeyFromName(name: string, label?: string | null): string {
  const normalized = normalizeExerciseName(name);
  const keyName = normalized ?? name.trim().toLowerCase();
  return `${keyName}|${(label ?? "").trim().toLowerCase()}`;
}

function rowMatchesStep(row: ParsedExercise, step: StructureBlockInput["steps"][number]): boolean {
  const stepName = step.exerciseName ?? step.customLabel;
  if (!stepName) return false;
  return exerciseKeyFromName(row.exerciseName, row.customLabel) === exerciseKeyFromName(stepName, step.customLabel);
}

function assignRowsToStructureBlocks(
  rows: readonly ParsedExercise[],
  blocks: readonly StructureBlockInput[],
): ParsedExercise[] {
  if (rows.some((row) => row.sets.some((set) => set.blockId))) return [...rows];
  const nextRows = rows.map((row) => ({ ...row, sets: row.sets.map((set) => ({ ...set })) }));
  const usedRows = new Set<number>();

  for (const block of blocks) {
    const blockId = block.id;
    if (!blockId) continue;
    for (const step of block.steps) {
      if (!isWorkStructureStep(step)) continue;
      let rowIndex = nextRows.findIndex((row, idx) => !usedRows.has(idx) && rowMatchesStep(row, step));
      if (rowIndex < 0) rowIndex = nextRows.findIndex((_row, idx) => !usedRows.has(idx));
      if (rowIndex < 0) return nextRows;
      usedRows.add(rowIndex);
      nextRows[rowIndex].sets = nextRows[rowIndex].sets.map((set) => ({
        ...set,
        blockId,
        stepNumber: step.stepNumber,
        intervalMinute: step.minuteIndex ?? undefined,
        stepRole: step.stepRole ?? step.stepType ?? "work",
        groupId: step.groupId ?? undefined,
      }));
    }
  }
  return nextRows;
}

function parsedRowsFromStructureBlocks(blocks: readonly StructureBlockInput[]): ParsedExercise[] {
  const rows: ParsedExercise[] = [];
  for (const block of blocks) {
    if (!block.id) continue;
    for (const step of block.steps) {
      if (!isWorkStructureStep(step) || !step.exerciseName) continue;
      const normalizedName = normalizeExerciseName(step.exerciseName);
      const exerciseName = normalizedName ?? "custom";
      const customLabel = normalizedName ? step.customLabel ?? undefined : step.customLabel ?? step.exerciseName;
      rows.push({
        exerciseName,
        category: step.category ?? (normalizedName ? EXERCISE_DEFINITIONS[normalizedName].category : "conditioning"),
        customLabel,
        sets: [{
          setNumber: 1,
          reps: targetNumber(step.targets, "targetReps", "reps"),
          weight: targetNumber(step.targets, "targetWeight", "weight"),
          distance: targetNumber(step.targets, "targetDistance", "distance"),
          time: targetNumber(step.targets, "targetTime", "time", "durationSeconds"),
          blockId: block.id,
          stepNumber: step.stepNumber,
          intervalMinute: step.minuteIndex ?? undefined,
          stepRole: step.stepRole ?? step.stepType ?? "work",
          groupId: step.groupId ?? undefined,
        }],
      });
    }
  }
  return rows;
}

export function rowsForParsedStructure(parsed: ParseWorkoutStructureResponse): {
  readonly exercises: ParsedExercise[];
  readonly structureBlocks: StructureBlockInput[];
} {
  const structureBlocks = ensureStructureBlockIds(parsed.structureBlocks);
  const exercises = parsed.exercises.length > 0
    ? assignRowsToStructureBlocks(parsed.exercises, structureBlocks)
    : parsedRowsFromStructureBlocks(structureBlocks);
  return { exercises, structureBlocks };
}

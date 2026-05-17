import { randomUUID } from "node:crypto";

import { type ParsedExercise, type StructureBlockInput, structureBlockSchema } from "@shared/schema";

import {
  type NormalizedParserPayload,
  parserWarnings,
  type RawParserStructureBlock,
  type RawParserStructureStep,
} from "./schema";

const EMOM_DURATION_PATTERN = /\bemom\s*(?:for\s*)?(\d{1,3})(?:\s*(?:min|mins|minute|minutes))?\b/i;

function parseEmomDurationSeconds(text: string): number | null {
  const match = EMOM_DURATION_PATTERN.exec(text);
  if (!match) return null;

  const minutes = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;

  return minutes * 60;
}

export function mapMinuteRestStepsForEmom(
  text: string,
  block: RawParserStructureBlock,
): { block: RawParserStructureBlock; warnings: string[] } {
  if (block.formatType.toLowerCase() !== "emom") return { block, warnings: [] };

  const mappedSteps = block.steps.map((step) => {
    if (typeof step.exerciseName === "string" && /^rest$/i.test(step.exerciseName.trim())) {
      return { ...step, stepRole: "rest" };
    }
    return step;
  });
  const minPattern = /\bmin(?:ute)?\s*(\d{1,3})\s*:\s*([^\n,;]+)/gi;
  const minuteMatches = [...text.matchAll(minPattern)];
  const warnings: string[] = [];

  if (minuteMatches.length > 0) {
    const minuteToRole = new Map<number, "work" | "rest">();
    const seenMinutes = new Set<number>();
    let hasDuplicateMinutes = false;

    for (const match of minuteMatches) {
      const minute = Number.parseInt(match[1] ?? "", 10);
      const description = (match[2] ?? "").trim();
      if (!Number.isFinite(minute) || minute <= 0) continue;
      if (seenMinutes.has(minute)) hasDuplicateMinutes = true;
      seenMinutes.add(minute);
      minuteToRole.set(minute, /^rest$/i.test(description) ? "rest" : "work");
    }

    const sortedMinutes = [...minuteToRole.keys()].sort((a, b) => a - b);
    const hasGapsOrOffset = sortedMinutes.some((minute, index) => minute !== index + 1);
    if (hasDuplicateMinutes || minuteToRole.size !== mappedSteps.length || hasGapsOrOffset) {
      warnings.push("Ambiguous EMOM minute mapping: free-text minute count does not match parsed steps.");
    }

    return {
      block: {
        ...block,
        steps: mappedSteps.map((step, index) => ({
          ...step,
          minuteIndex: step.minuteIndex ?? (index + 1),
          stepRole: step.stepRole ?? minuteToRole.get(index + 1) ?? "work",
        })),
        durationSeconds: block.durationSeconds ?? parseEmomDurationSeconds(text),
      },
      warnings,
    };
  }

  return {
    block: {
      ...block,
      steps: mappedSteps.map((step, index) => ({
        ...step,
        minuteIndex: step.minuteIndex ?? (index + 1),
        stepRole: step.stepRole ?? "work",
      })),
      durationSeconds: block.durationSeconds ?? parseEmomDurationSeconds(text),
    },
    warnings,
  };
}

function normalizeSectionType(raw: string): StructureBlockInput["sectionType"] {
  if (raw === "activation") return "activation";
  if (raw === "warmup" || raw === "main" || raw === "accessory" || raw === "cooldown" || raw === "mobility") {
    return raw;
  }
  return "main";
}

function normalizeFormatType(raw: string): StructureBlockInput["formatType"] {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "straight_sets") return "steady";
  if (
    normalized === "emom" ||
    normalized === "amrap" ||
    normalized === "rounds" ||
    normalized === "interval" ||
    normalized === "for_time" ||
    normalized === "quality"
  ) {
    return normalized;
  }
  return "steady";
}

function normalizeStepType(step: RawParserStructureStep): "work" | "rest" | "transition" {
  const raw = (step.stepType ?? step.stepRole ?? "work").trim().toLowerCase();
  if (raw === "rest") return "rest";
  if (raw === "transition") return "transition";
  return "work";
}

function durationMinutesFromBlock(block: RawParserStructureBlock): number | null {
  if (typeof block.durationMinutes === "number" && Number.isFinite(block.durationMinutes)) {
    return Math.max(1, Math.trunc(block.durationMinutes));
  }
  if (typeof block.timeCapMinutes === "number" && Number.isFinite(block.timeCapMinutes)) {
    return Math.max(1, Math.trunc(block.timeCapMinutes));
  }
  if (typeof block.durationSeconds === "number" && Number.isFinite(block.durationSeconds) && block.durationSeconds > 0) {
    return Math.max(1, Math.round(block.durationSeconds / 60));
  }
  return null;
}

function normalizeParserBlock(rawBlock: RawParserStructureBlock): StructureBlockInput | null {
  const formatType = normalizeFormatType(rawBlock.formatType);
  const durationMinutes = durationMinutesFromBlock(rawBlock);
  const block: StructureBlockInput = {
    id: rawBlock.id ?? randomUUID(),
    sectionType: normalizeSectionType(rawBlock.sectionType),
    formatType,
    durationSeconds: rawBlock.durationSeconds ?? null,
    durationMinutes: formatType === "emom" || formatType === "amrap"
      ? durationMinutes
      : rawBlock.durationMinutes ?? null,
    roundCount: rawBlock.roundCount ?? rawBlock.rounds ?? null,
    rounds: rawBlock.rounds ?? null,
    timeCapMinutes: rawBlock.timeCapMinutes ?? (formatType === "amrap" ? durationMinutes : null),
    workSeconds: rawBlock.workSeconds ?? null,
    restSeconds: rawBlock.restSeconds ?? null,
    steps: rawBlock.steps.map((step, index) => {
      const stepType = normalizeStepType(step);
      return {
        stepNumber: step.stepNumber ?? index + 1,
        minuteIndex: formatType === "emom" ? step.minuteIndex ?? index + 1 : step.minuteIndex ?? null,
        stepType,
        exerciseName: stepType === "rest" ? null : step.exerciseName ?? null,
        category: step.category ?? (stepType === "rest" ? null : "conditioning"),
        customLabel: step.customLabel ?? null,
        stepRole: step.stepRole ?? stepType,
        targets: step.targets ?? null,
      };
    }),
  };
  const parsed = structureBlockSchema.safeParse(block);
  return parsed.success ? parsed.data : null;
}

export function normalizeParserBlocks(
  text: string,
  rawBlocks: NormalizedParserPayload["structureBlocks"],
): { structureBlocks: StructureBlockInput[]; warnings: string[] } {
  const structureBlocks: StructureBlockInput[] = [];
  const warnings: string[] = [];

  for (const rawBlock of rawBlocks) {
    const { block, warnings: emomWarnings } = mapMinuteRestStepsForEmom(text, rawBlock);
    warnings.push(...emomWarnings);

    const normalized = normalizeParserBlock(block);
    if (normalized) {
      structureBlocks.push(normalized);
    } else {
      warnings.push("Structure block skipped: parsed format or steps did not pass validation.");
    }
  }

  return { structureBlocks, warnings };
}

function parserStepKey(name: string | null | undefined, label?: string | null): string {
  return `${(name ?? "").trim().toLowerCase()}|${(label ?? "").trim().toLowerCase()}`;
}

function rowMatchesStructureStep(row: ParsedExercise, step: StructureBlockInput["steps"][number]): boolean {
  const stepName = step.exerciseName ?? step.customLabel;
  if (!stepName) return false;

  return parserStepKey(row.exerciseName, row.customLabel) === parserStepKey(stepName, step.customLabel);
}

export function linkRowsToStructureBlocks(
  rows: readonly ParsedExercise[],
  blocks: readonly StructureBlockInput[],
): ParsedExercise[] {
  if (rows.some((row) => row.sets.some((set) => set.blockId))) return [...rows];

  const nextRows = rows.map((row) => ({ ...row, sets: row.sets.map((set) => ({ ...set })) }));
  const usedRows = new Set<number>();

  for (const block of blocks) {
    if (!block.id) continue;

    for (const step of block.steps) {
      if ((step.stepType ?? "work") !== "work") continue;

      let rowIndex = nextRows.findIndex((row, index) => !usedRows.has(index) && rowMatchesStructureStep(row, step));
      if (rowIndex < 0) rowIndex = nextRows.findIndex((_row, index) => !usedRows.has(index));
      if (rowIndex < 0) return nextRows;

      usedRows.add(rowIndex);
      nextRows[rowIndex].sets = nextRows[rowIndex].sets.map((set) => ({
        ...set,
        blockId: block.id,
        stepNumber: step.stepNumber,
        intervalMinute: step.minuteIndex ?? undefined,
        stepRole: step.stepRole ?? step.stepType ?? "work",
        groupId: step.groupId ?? undefined,
      }));
    }
  }

  return nextRows;
}

export function collectExerciseStructureWarnings(
  text: string,
  normalized: NormalizedParserPayload,
): string[] {
  const structureWarnings = parserWarnings(normalized.warnings);
  const emomMapped = normalized.structureBlocks.map((block) => mapMinuteRestStepsForEmom(text, block));

  for (const mapped of emomMapped) structureWarnings.push(...mapped.warnings);

  if (normalized.structureBlocks.length === 0) {
    structureWarnings.push("Structure unresolved: section/format/step sequence not fully identified.");
  }

  return structureWarnings;
}

export function addStructureWarningsToFirstRow(
  rows: ParsedExercise[],
  structureWarnings: string[],
  structureConfidence: number | null | undefined,
): ParsedExercise[] {
  return rows.map((row, index) => {
    if (index > 0) return row;

    const addWarnings: string[] = [...(row.missingFields ?? []), ...structureWarnings];
    if (typeof structureConfidence === "number" && structureConfidence < 70) {
      addWarnings.push(`Low structure confidence (${Math.round(structureConfidence)}/100).`);
    }

    return { ...row, missingFields: addWarnings.length ? addWarnings : row.missingFields };
  });
}

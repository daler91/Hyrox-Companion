import { exerciseSetSchema, type ParsedExercise, type StructureBlockInput } from "@shared/schema";
import { EXERCISE_DEFINITIONS } from "@shared/schema/exercises";
import { z } from "zod";

import { AppError, ErrorCode } from "../../errors";
import { logger } from "../../logger";

const parserExerciseSetSchema = exerciseSetSchema.and(z.object({
  weightUnit: z.string().max(32).optional().nullable(),
  distanceUnit: z.string().max(32).optional().nullable(),
}));

const defaultSetsForLenience: z.infer<typeof parserExerciseSetSchema>[] = [{ setNumber: 1 }];

function inferCategoryFromExerciseName(name: unknown): string {
  if (typeof name !== "string") return "conditioning";
  const known = (EXERCISE_DEFINITIONS as Record<string, { category: string } | undefined>)[name];
  return known?.category ?? "conditioning";
}

export const parsedExerciseSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;

  const row = { ...(raw as Record<string, unknown>) };
  if (typeof row.category !== "string" || row.category.trim().length === 0) {
    row.category = inferCategoryFromExerciseName(row.exerciseName);
  }
  if (!Array.isArray(row.sets) || (row.sets as unknown[]).length === 0) {
    row.sets = defaultSetsForLenience;
  }

  return row;
}, z.object({
  exerciseName: z.string().min(1, "exerciseName must not be empty"),
  category: z.string(),
  customLabel: z.string().optional().nullable(),
  confidence: z.number().min(0).max(100).optional().nullable(),
  missingFields: z.array(z.string()).optional().nullable(),
  sets: z.array(parserExerciseSetSchema).min(1),
}));

export const parserResponseSchema = z.object({
  exercises: z.array(parsedExerciseSchema).optional().default([]),
  structureBlocks: z.array(z.object({
    id: z.string().optional().nullable(),
    sectionType: z.string().min(1),
    formatType: z.string().min(1),
    durationSeconds: z.number().optional().nullable(),
    durationMinutes: z.number().optional().nullable(),
    rounds: z.number().optional().nullable(),
    roundCount: z.number().optional().nullable(),
    timeCapMinutes: z.number().optional().nullable(),
    workSeconds: z.number().optional().nullable(),
    restSeconds: z.number().optional().nullable(),
    steps: z.array(z.object({
      stepNumber: z.number().int().min(1),
      minuteIndex: z.number().int().min(1).optional().nullable(),
      stepType: z.string().optional().nullable(),
      exerciseName: z.string().min(1).optional().nullable(),
      category: z.string().min(1).optional().nullable(),
      customLabel: z.string().optional().nullable(),
      stepRole: z.string().optional().nullable(),
      targets: z.record(z.string(), z.unknown()).optional().nullable(),
    })).min(1),
  })).optional().default([]),
  warnings: z.array(z.string()).optional().default([]),
  confidence: z.object({
    exerciseMapping: z.number().min(0).max(100).optional().nullable(),
    structureQuality: z.number().min(0).max(100).optional().nullable(),
  }).optional().nullable(),
});

const structureBlocksSchema = parserResponseSchema.shape.structureBlocks;

export type ParserExercise = z.infer<typeof parsedExerciseSchema>;

export type NormalizedParserPayload = {
  exercises: unknown[];
  structureBlocks: z.infer<typeof parserResponseSchema.shape.structureBlocks>;
  warnings: z.infer<typeof parserResponseSchema.shape.warnings>;
  confidence: z.infer<typeof parserResponseSchema.shape.confidence>;
};

export type RawParserStructureBlock = NormalizedParserPayload["structureBlocks"][number];
export type RawParserStructureStep = RawParserStructureBlock["steps"][number];

export interface ParsedWorkoutStructure {
  exercises: ParsedExercise[];
  structureBlocks: StructureBlockInput[];
  warnings: string[];
  confidence: NormalizedParserPayload["confidence"];
}

export function normalizeParserPayload(raw: unknown): NormalizedParserPayload {
  if (Array.isArray(raw)) {
    return { exercises: raw as unknown[], structureBlocks: [], warnings: [], confidence: null };
  }
  if (!raw || typeof raw !== "object") {
    return { exercises: [], structureBlocks: [], warnings: [], confidence: null };
  }

  const shape = raw as Record<string, unknown>;
  const exercises: unknown[] = Array.isArray(shape.exercises) ? (shape.exercises as unknown[]) : [];
  const structureBlocks = structureBlocksSchema.safeParse(shape.structureBlocks);
  const warnings = z.array(z.string()).safeParse(shape.warnings);
  const confidence = parserResponseSchema.shape.confidence.safeParse(shape.confidence);

  return {
    exercises,
    structureBlocks: structureBlocks.success ? structureBlocks.data : [],
    warnings: warnings.success ? warnings.data : [],
    confidence: confidence.success ? confidence.data : null,
  };
}

export function parserWarnings(warnings: NormalizedParserPayload["warnings"]): string[] {
  return (warnings ?? []).filter((warning) => typeof warning === "string" && warning.trim().length > 0);
}

export function parseRawResponse(responseText: string): unknown {
  const parsed = parseRawResponseSafe(responseText);
  if (parsed === undefined) {
    logger.error("[ai] exercise-parse JSON.parse failed.");
    throw new AppError(ErrorCode.AI_ERROR, "AI returned invalid JSON for exercise parsing", 502);
  }
  return parsed;
}

// Like parseRawResponse but returns undefined instead of throwing when the AI
// response is not valid JSON, so callers can attempt heuristic recovery from the
// original source text before surfacing an error. Valid JSON never parses to
// undefined, so undefined unambiguously signals a parse failure.
export function parseRawResponseSafe(responseText: string): unknown {
  try {
    return JSON.parse(responseText);
  } catch {
    return undefined;
  }
}

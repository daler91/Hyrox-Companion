import type { ParsedExercise } from "@shared/schema";

import { AppError, ErrorCode } from "../../errors";
import { logger } from "../../logger";
import { heuristicFallbackRowsFromText } from "./fallback";
import { mapValidatedExercise, resolveParseUnitPreferences } from "./mapping";
import { callTextProviderParse } from "./provider";
import {
  normalizeParserPayload,
  type ParsedWorkoutStructure,
  parseRawResponse,
  parserWarnings,
} from "./schema";
import {
  addStructureWarningsToFirstRow,
  collectExerciseStructureWarnings,
  linkRowsToStructureBlocks,
  normalizeParserBlocks,
} from "./structure";
import type {
  ParseExercisesWithDiagnosticsResult,
  ParseUnitInput,
  ParseWorkoutStructureWithDiagnosticsResult,
} from "./types";
import { validateRows, validateRowsDetailed } from "./validation";

export async function parseExercisesFromText(
  text: string,
  unitsInput: ParseUnitInput = "kg",
  customExerciseNames?: string[],
  userId?: string,
): Promise<ParsedExercise[]> {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const units = resolveParseUnitPreferences(unitsInput);

  try {
    const responseText = await callTextProviderParse(text, units, customExerciseNames, userId);
    const raw = parseRawResponse(responseText);
    const rawArray = Array.isArray(raw) ? raw : [];
    const normalized = normalizeParserPayload(raw);
    const validated = validateRows(normalized.exercises ?? rawArray);

    if (validated.length === 0) {
      const fallbackValidated = validateRows(heuristicFallbackRowsFromText(text));
      if (fallbackValidated.length > 0) {
        logger.warn("[ai] exercise-parse recovered rows with heuristic fallback");
        return fallbackValidated.map((exercise) => mapValidatedExercise(exercise, text, units));
      }
      logger.warn("[ai] exercise-parse no valid rows after validation");
      return [];
    }

    const mapped = validated.map((exercise) => mapValidatedExercise(exercise, text, units));
    return addStructureWarningsToFirstRow(
      mapped,
      collectExerciseStructureWarnings(text, normalized),
      normalized.confidence?.structureQuality,
    );
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    logger.error("[ai] exercise-parse error");
    throw new AppError(ErrorCode.AI_ERROR, "Failed to parse exercises from text", 502);
  }
}

export async function parseWorkoutStructureFromText(
  text: string,
  unitsInput: ParseUnitInput = "kg",
  customExerciseNames?: string[],
  userId?: string,
): Promise<ParsedWorkoutStructure> {
  if (!text || text.trim().length === 0) {
    return { exercises: [], structureBlocks: [], warnings: [], confidence: null };
  }

  const units = resolveParseUnitPreferences(unitsInput);
  const responseText = await callTextProviderParse(text, units, customExerciseNames, userId);
  const raw = parseRawResponse(responseText);
  const rawArray = Array.isArray(raw) ? raw : [];
  const normalized = normalizeParserPayload(raw);
  const validated = validateRows(normalized.exercises ?? rawArray);
  const fallbackUsed = validated.length === 0;
  const fallbackRows = fallbackUsed ? validateRows(heuristicFallbackRowsFromText(text)) : [];
  const { structureBlocks, warnings } = normalizeParserBlocks(text, normalized.structureBlocks);
  const rows = linkRowsToStructureBlocks(
    (validated.length > 0 ? validated : fallbackRows).map((exercise) => mapValidatedExercise(exercise, text, units)),
    structureBlocks,
  );

  return {
    exercises: rows,
    structureBlocks,
    warnings: [...parserWarnings(normalized.warnings), ...warnings],
    confidence: normalized.confidence,
  };
}

export async function parseExercisesFromTextWithDiagnostics(
  text: string,
  unitsInput: ParseUnitInput = "kg",
  customExerciseNames?: string[],
  userId?: string,
): Promise<ParseExercisesWithDiagnosticsResult> {
  if (!text || text.trim().length === 0) {
    return { acceptedRows: [], rejectedRows: [], fallbackUsed: false };
  }

  const units = resolveParseUnitPreferences(unitsInput);
  const responseText = await callTextProviderParse(text, units, customExerciseNames, userId);
  const raw = parseRawResponse(responseText);
  const rawArray = Array.isArray(raw) ? raw : [];
  const normalized = normalizeParserPayload(raw);
  const validated = validateRowsDetailed(normalized.exercises ?? rawArray);

  if (validated.acceptedRows.length > 0) {
    return {
      acceptedRows: validated.acceptedRows.map((exercise) => mapValidatedExercise(exercise, text, units)),
      rejectedRows: validated.rejectedRows,
      fallbackUsed: false,
    };
  }

  const fallbackValidated = validateRowsDetailed(heuristicFallbackRowsFromText(text));
  if (fallbackValidated.acceptedRows.length > 0) {
    return {
      acceptedRows: fallbackValidated.acceptedRows.map((exercise) => mapValidatedExercise(exercise, text, units)),
      rejectedRows: [...validated.rejectedRows, ...fallbackValidated.rejectedRows],
      fallbackUsed: true,
    };
  }

  return { acceptedRows: [], rejectedRows: validated.rejectedRows, fallbackUsed: false };
}

export async function parseWorkoutStructureFromTextWithDiagnostics(
  text: string,
  unitsInput: ParseUnitInput = "kg",
  customExerciseNames?: string[],
  userId?: string,
): Promise<ParseWorkoutStructureWithDiagnosticsResult> {
  if (!text || text.trim().length === 0) {
    return { acceptedRows: [], rejectedRows: [], fallbackUsed: false, structureBlocks: [], warnings: [], confidence: null };
  }

  const units = resolveParseUnitPreferences(unitsInput);
  const responseText = await callTextProviderParse(text, units, customExerciseNames, userId);
  const raw = parseRawResponse(responseText);
  const rawArray = Array.isArray(raw) ? raw : [];
  const normalized = normalizeParserPayload(raw);
  const validated = validateRowsDetailed(normalized.exercises ?? rawArray);
  const { structureBlocks, warnings } = normalizeParserBlocks(text, normalized.structureBlocks);
  const structureWarnings = parserWarnings(normalized.warnings);

  if (validated.acceptedRows.length > 0) {
    return {
      acceptedRows: linkRowsToStructureBlocks(
        validated.acceptedRows.map((exercise) => mapValidatedExercise(exercise, text, units)),
        structureBlocks,
      ),
      rejectedRows: validated.rejectedRows,
      fallbackUsed: false,
      structureBlocks,
      warnings: [...structureWarnings, ...warnings],
      confidence: normalized.confidence,
    };
  }

  const fallbackValidated = validateRowsDetailed(heuristicFallbackRowsFromText(text));
  return {
    acceptedRows: linkRowsToStructureBlocks(
      fallbackValidated.acceptedRows.map((exercise) => mapValidatedExercise(exercise, text, units)),
      structureBlocks,
    ),
    rejectedRows: [...validated.rejectedRows, ...fallbackValidated.rejectedRows],
    fallbackUsed: fallbackValidated.acceptedRows.length > 0,
    structureBlocks,
    warnings: [...structureWarnings, ...warnings],
    confidence: normalized.confidence,
  };
}

import type { ParsedExercise } from "@shared/schema";

import { AppError, ErrorCode } from "../../errors";
import { logger } from "../../logger";
import { mapValidatedExercise, resolveParseUnitPreferences } from "./mapping";
import { callGeminiParseImage } from "./provider";
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
  ParseExercisesFromImageInput,
  ParseExercisesWithDiagnosticsResult,
  ParseWorkoutStructureWithDiagnosticsResult,
} from "./types";
import { validateRows, validateRowsDetailed } from "./validation";

export async function parseExercisesFromImage(
  input: ParseExercisesFromImageInput,
): Promise<ParsedExercise[]> {
  const {
    imageBase64,
    mimeType,
    weightUnit = "kg",
    distanceUnit = "km",
    customExerciseNames,
    userId,
  } = input;
  const units = resolveParseUnitPreferences({ weightUnit, distanceUnit });

  try {
    const responseText = await callGeminiParseImage(
      imageBase64,
      mimeType,
      units,
      customExerciseNames,
      userId,
    );
    const raw = parseRawResponse(responseText);
    const rawArray = Array.isArray(raw) ? raw : [];
    const normalized = normalizeParserPayload(raw);
    const validated = validateRows(normalized.exercises ?? rawArray);

    if (validated.length === 0) {
      logger.warn(
        { rawExerciseCount: normalized.exercises.length },
        "[gemini] exercise-parse-image no valid rows after validation",
      );
      return [];
    }

    const mapped = validated.map((exercise) => mapValidatedExercise(exercise, "", units));
    return addStructureWarningsToFirstRow(
      mapped,
      collectExerciseStructureWarnings("", normalized),
      normalized.confidence?.structureQuality,
    );
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    logger.error({ err: error }, "[gemini] exercise-parse-image error:");
    throw new AppError(ErrorCode.AI_ERROR, "Failed to parse exercises from image", 502);
  }
}

export async function parseWorkoutStructureFromImage(
  input: ParseExercisesFromImageInput,
): Promise<ParsedWorkoutStructure> {
  const {
    imageBase64,
    mimeType,
    weightUnit = "kg",
    distanceUnit = "km",
    customExerciseNames,
    userId,
  } = input;
  const units = resolveParseUnitPreferences({ weightUnit, distanceUnit });
  const responseText = await callGeminiParseImage(
    imageBase64,
    mimeType,
    units,
    customExerciseNames,
    userId,
  );
  const raw = parseRawResponse(responseText);
  const rawArray = Array.isArray(raw) ? raw : [];
  const normalized = normalizeParserPayload(raw);
  const validated = validateRows(normalized.exercises ?? rawArray);
  const { structureBlocks, warnings } = normalizeParserBlocks("", normalized.structureBlocks);
  const rows = linkRowsToStructureBlocks(
    validated.map((exercise) => mapValidatedExercise(exercise, "", units)),
    structureBlocks,
  );

  return {
    exercises: rows,
    structureBlocks,
    warnings: [...parserWarnings(normalized.warnings), ...warnings],
    confidence: normalized.confidence,
  };
}

export async function parseExercisesFromImageWithDiagnostics(
  input: ParseExercisesFromImageInput,
): Promise<ParseExercisesWithDiagnosticsResult> {
  const { imageBase64, mimeType, weightUnit = "kg", distanceUnit = "km", customExerciseNames, userId } = input;
  const units = resolveParseUnitPreferences({ weightUnit, distanceUnit });
  const responseText = await callGeminiParseImage(imageBase64, mimeType, units, customExerciseNames, userId);
  const raw = parseRawResponse(responseText);
  const rawArray = Array.isArray(raw) ? raw : [];
  const normalized = normalizeParserPayload(raw);
  const validated = validateRowsDetailed(normalized.exercises ?? rawArray);

  return {
    acceptedRows: validated.acceptedRows.map((exercise) => mapValidatedExercise(exercise, "", units)),
    rejectedRows: validated.rejectedRows,
    fallbackUsed: false,
  };
}

export async function parseWorkoutStructureFromImageWithDiagnostics(
  input: ParseExercisesFromImageInput,
): Promise<ParseWorkoutStructureWithDiagnosticsResult> {
  const { imageBase64, mimeType, weightUnit = "kg", distanceUnit = "km", customExerciseNames, userId } = input;
  const units = resolveParseUnitPreferences({ weightUnit, distanceUnit });
  const responseText = await callGeminiParseImage(imageBase64, mimeType, units, customExerciseNames, userId);
  const raw = parseRawResponse(responseText);
  const rawArray = Array.isArray(raw) ? raw : [];
  const normalized = normalizeParserPayload(raw);
  const validated = validateRowsDetailed(normalized.exercises ?? rawArray);
  const { structureBlocks, warnings } = normalizeParserBlocks("", normalized.structureBlocks);

  return {
    acceptedRows: linkRowsToStructureBlocks(
      validated.acceptedRows.map((exercise) => mapValidatedExercise(exercise, "", units)),
      structureBlocks,
    ),
    rejectedRows: validated.rejectedRows,
    fallbackUsed: false,
    structureBlocks,
    warnings: [...parserWarnings(normalized.warnings), ...warnings],
    confidence: normalized.confidence,
  };
}

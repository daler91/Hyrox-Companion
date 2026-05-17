import type { ParsedExercise, StructureBlockInput } from "@shared/schema";
import type { UnitPreferences } from "@shared/unitConversion";

import type { NormalizedParserPayload } from "./schema";

export interface ParseUnitPreferences extends UnitPreferences {
  readonly weightUnit?: string | null;
  readonly distanceUnit?: string | null;
}

export type ParseUnitInput = string | ParseUnitPreferences | undefined | null;

export interface ParseExercisesWithDiagnosticsResult {
  acceptedRows: ParsedExercise[];
  rejectedRows: { index: number; reason: string }[];
  fallbackUsed: boolean;
}

export interface ParseWorkoutStructureWithDiagnosticsResult extends ParseExercisesWithDiagnosticsResult {
  structureBlocks: StructureBlockInput[];
  warnings: string[];
  confidence: NormalizedParserPayload["confidence"];
}

export interface ParseExercisesFromImageInput {
  readonly imageBase64: string;
  readonly mimeType: string;
  readonly weightUnit?: string;
  readonly distanceUnit?: string;
  readonly customExerciseNames?: string[];
  readonly userId?: string;
}

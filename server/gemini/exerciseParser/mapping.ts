import type { ParsedExercise } from "@shared/schema";
import {
  normalizeParsedDistance,
  normalizeParsedWeight,
  standardizeDistanceUnit,
  standardizeWeightUnit,
  type UnitPreferences,
} from "@shared/unitConversion";

import { VALID_CATEGORIES, VALID_EXERCISE_NAMES } from "../../prompts";
import type { ParserExercise } from "./schema";
import type { ParseUnitInput, ParseUnitPreferences } from "./types";

const EXERCISE_UNIT_TOKENS = new Set([
  "x",
  "kg",
  "lb",
  "lbs",
  "m",
  "km",
  "min",
  "sec",
  "s",
  "rep",
  "reps",
  "set",
  "sets",
]);

interface MappedCustomFields {
  customLabel: string | undefined;
  confidence: number;
  missingName: boolean;
}

export function sanitizeLabel(value: string): string {
  return value.replaceAll("&", "and");
}

export function resolveParseUnitPreferences(input: ParseUnitInput): Required<ParseUnitPreferences> {
  if (typeof input === "string") {
    return { weightUnit: standardizeWeightUnit(input), distanceUnit: "km" };
  }

  return {
    weightUnit: standardizeWeightUnit(input?.weightUnit),
    distanceUnit: standardizeDistanceUnit(input?.distanceUnit),
  };
}

function synthesizeCustomLabel(sourceText: string): string {
  const cleaned = sourceText
    .replaceAll(/\d+/g, " ")
    .replaceAll(/[^a-zA-Z\- ]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  const words = cleaned
    .split(" ")
    .filter((word) => word.length > 1 && !EXERCISE_UNIT_TOKENS.has(word.toLowerCase()))
    .slice(0, 4);

  if (words.length === 0) return "Unknown exercise";

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function resolveConfidence(raw: ParserExercise, isKnown: boolean): number {
  if (typeof raw.confidence === "number") {
    return Math.min(100, Math.max(0, Math.round(raw.confidence)));
  }

  return isKnown ? 95 : 50;
}

function resolveCustomFields(
  exercise: ParserExercise,
  isKnown: boolean,
  sourceText: string,
  baseConfidence: number,
): MappedCustomFields {
  if (isKnown) {
    return {
      customLabel: exercise.customLabel ? sanitizeLabel(exercise.customLabel) : undefined,
      confidence: baseConfidence,
      missingName: false,
    };
  }

  const suppliedLabel = exercise.customLabel?.trim();
  const candidate =
    (suppliedLabel && suppliedLabel.length > 0 && suppliedLabel) ||
    (exercise.exerciseName !== "custom" && exercise.exerciseName.trim().length > 0 && exercise.exerciseName) ||
    synthesizeCustomLabel(sourceText);
  const missingName = !suppliedLabel;

  return {
    customLabel: sanitizeLabel(candidate),
    confidence: missingName ? Math.min(baseConfidence, 40) : baseConfidence,
    missingName,
  };
}

export function mapValidatedExercise(
  exercise: ParserExercise,
  sourceText: string,
  unitPreferences: UnitPreferences = {},
): ParsedExercise {
  const isKnown = VALID_EXERCISE_NAMES.has(exercise.exerciseName) && exercise.exerciseName !== "custom";
  const validCategory = VALID_CATEGORIES.has(exercise.category);
  const baseConfidence = resolveConfidence(exercise, isKnown);
  const custom = resolveCustomFields(exercise, isKnown, sourceText, baseConfidence);
  const missingFields = Array.isArray(exercise.missingFields)
    ? exercise.missingFields
        .filter((field) => typeof field === "string" && field.length > 0)
        .map(sanitizeLabel)
    : [];

  if (custom.missingName) missingFields.push("Name");

  return {
    exerciseName: isKnown ? sanitizeLabel(exercise.exerciseName) : "custom",
    category: validCategory ? sanitizeLabel(exercise.category) : "conditioning",
    customLabel: custom.customLabel,
    confidence: custom.confidence,
    missingFields: missingFields.length > 0 ? missingFields : undefined,
    sets: exercise.sets.map((set, index) => ({
      setNumber: set.setNumber || index + 1,
      ...(set.reps != null && { reps: set.reps }),
      ...(set.weight != null && { weight: normalizeParsedWeight(set.weight, set.weightUnit, unitPreferences) }),
      ...(set.distance != null && {
        distance: normalizeParsedDistance(set.distance, set.distanceUnit, unitPreferences),
      }),
      ...(set.time != null && { time: set.time }),
    })),
  };
}

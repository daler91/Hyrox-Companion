import { EXERCISE_DEFINITIONS, type ExerciseName } from "@shared/schema";
import type { StructuredExercise } from "@/components/ExerciseInput";

interface FieldRequirement {
  field: string;
  label: string;
}

const CRITICAL_FIELDS: Record<string, FieldRequirement[]> = {
  strength: [
    { field: "weight", label: "Weight" },
    { field: "reps", label: "Reps" },
  ],
  hyrox_station: [
    { field: "time", label: "Time" },
  ],
  running: [
    { field: "distance", label: "Distance" },
    { field: "time", label: "Time" },
  ],
  conditioning: [
    { field: "reps", label: "Reps" },
  ],
};

function getCategory(exercise: StructuredExercise): string {
  if (exercise.exerciseName === "custom") {
    return exercise.category || "conditioning";
  }
  const def = EXERCISE_DEFINITIONS[exercise.exerciseName];
  return def?.category || exercise.category || "conditioning";
}

function getRelevantFields(exercise: StructuredExercise): readonly string[] {
  const def = EXERCISE_DEFINITIONS[exercise.exerciseName];
  if (def) return def.fields;
  return ["sets", "reps", "weight", "distance", "time"];
}

function isFieldMissing(exercise: StructuredExercise, field: string): boolean {
  if (exercise.sets.length === 0) return false;
  return exercise.sets.every(
    (s) => s[field as keyof typeof s] === undefined || s[field as keyof typeof s] === null
  );
}

export function getMissingFieldWarnings(exercise: StructuredExercise): string[] {
  const category = getCategory(exercise);
  const criticalFields = CRITICAL_FIELDS[category];
  if (!criticalFields) return [];

  const relevantFields = getRelevantFields(exercise);
  const def = EXERCISE_DEFINITIONS[exercise.exerciseName];
  const displayLabel = exercise.exerciseName === "custom" && exercise.customLabel
    ? exercise.customLabel
    : def?.label || exercise.exerciseName;

  const warnings: string[] = [];

  for (const { field, label } of criticalFields) {
    if (!relevantFields.includes(field) && field !== "sets") continue;
    if (isFieldMissing(exercise, field)) {
      warnings.push(`${displayLabel} is missing ${label.toLowerCase()}`);
    }
  }

  return warnings;
}

export function getExerciseMissingFields(exercise: StructuredExercise): string[] {
  const category = getCategory(exercise);
  const criticalFields = CRITICAL_FIELDS[category];
  if (!criticalFields) return [];

  const relevantFields = getRelevantFields(exercise);
  const missing: string[] = [];

  for (const { field, label } of criticalFields) {
    if (!relevantFields.includes(field) && field !== "sets") continue;
    if (isFieldMissing(exercise, field)) {
      missing.push(label);
    }
  }

  return missing;
}

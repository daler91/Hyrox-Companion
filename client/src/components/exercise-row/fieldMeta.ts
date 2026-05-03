import { EXERCISE_DEFINITIONS, type ExerciseName } from "@shared/schema";

export type FieldKey = "reps" | "weight" | "distance" | "time";

export interface FieldContext {
  weightUnit: "kg" | "lbs";
  distanceUnit: "km" | "miles";
}

interface FieldSpec {
  label: (context: FieldContext) => string;
  defaultStep: number;
  stepOptions: readonly number[];
  shortLabel: string;
  validationHint: string;
  prefersMultiSet: boolean;
}

export const fieldMeta: Record<FieldKey, FieldSpec> = {
  reps: {
    label: () => "Reps",
    shortLabel: "Reps",
    defaultStep: 1,
    stepOptions: [1, 5],
    validationHint: "Whole number count",
    prefersMultiSet: true,
  },
  weight: {
    label: ({ weightUnit }) => `Weight (${weightUnit})`,
    shortLabel: "Wt",
    defaultStep: 2.5,
    stepOptions: [1, 2.5, 5, 10],
    validationHint: "Load per set",
    prefersMultiSet: true,
  },
  distance: {
    label: ({ distanceUnit }) => `Distance (${distanceUnit === "km" ? "m" : "ft"})`,
    shortLabel: "Dist",
    defaultStep: 50,
    stepOptions: [10, 50, 100, 500],
    validationHint: "Numeric distance",
    prefersMultiSet: false,
  },
  time: {
    label: () => "Time (min)",
    shortLabel: "Time",
    defaultStep: 1,
    stepOptions: [1, 5, 10],
    validationHint: "Duration in minutes",
    prefersMultiSet: false,
  },
};

// ⚡ Bolt: Cache array references to guarantee referential stability during re-renders.
const fieldsCache = new Map<string, FieldKey[]>();
const DEFAULT_FIELDS: FieldKey[] = ["reps", "weight"];

// Resolve which per-set fields an exercise surfaces, filtering out "sets" which
// is a row-level grouping concept, not a per-set field.
export function getFields(exerciseName: string): FieldKey[] {
  const cached = fieldsCache.get(exerciseName);
  if (cached) return cached;

  const def = EXERCISE_DEFINITIONS[exerciseName as ExerciseName];
  if (!def) return DEFAULT_FIELDS;

  const out: FieldKey[] = [];
  for (const f of def.fields as readonly string[]) {
    if (f !== "sets" && f in fieldMeta) out.push(f as FieldKey);
  }
  fieldsCache.set(exerciseName, out);
  return out;
}

export function getFieldSpec(field: FieldKey): FieldSpec {
  return fieldMeta[field];
}

export function getFieldLabel(field: FieldKey, context: FieldContext): string {
  return fieldMeta[field].label(context);
}

export function isFieldEditableForExercise(exerciseName: string, field: FieldKey): boolean {
  return getFields(exerciseName).includes(field);
}

export function shouldUseMultiSetForFields(fields: readonly FieldKey[]): boolean {
  return fields.some((field) => fieldMeta[field].prefersMultiSet);
}

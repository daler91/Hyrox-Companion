import { EXERCISE_DEFINITIONS, type ExerciseName } from "@shared/schema";

export type FieldKey = "reps" | "weight" | "distance" | "time";

interface FieldSpec {
  label: (weightUnit: string, distanceUnit: string) => string;
  defaultStep: number;
  stepOptions: readonly number[];
}

export const fieldMeta: Record<FieldKey, FieldSpec> = {
  reps: { label: () => "Reps", defaultStep: 1, stepOptions: [1, 5] },
  weight: { label: (wu) => `Weight (${wu})`, defaultStep: 2.5, stepOptions: [1, 2.5, 5, 10] },
  distance: {
    label: (_, du) => `Distance (${du === "km" ? "m" : "ft"})`,
    defaultStep: 50,
    stepOptions: [10, 50, 100, 500],
  },
  time: { label: () => "Time (min)", defaultStep: 1, stepOptions: [1, 5, 10] },
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

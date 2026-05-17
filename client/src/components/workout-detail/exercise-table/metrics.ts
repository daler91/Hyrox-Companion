import { type ExerciseSet } from "@shared/schema";
import { getWorkoutDistanceDisplay } from "@shared/unitConversion";

import { type FieldKey, getFields } from "@/components/exercise-row/fieldMeta";
import type { GroupedExercise } from "@/lib/exerciseUtils";

export type PlannedMetricField = "reps" | "weight" | "distance" | "time";

const PLANNED_FIELDS: readonly PlannedMetricField[] = ["reps", "weight", "distance", "time"];

function getActualValue(set: ExerciseSet, field: PlannedMetricField): number | null {
  return set[field] ?? null;
}

function getPlannedValue(set: ExerciseSet, field: PlannedMetricField): number | null {
  switch (field) {
    case "reps":
      return set.plannedReps ?? null;
    case "weight":
      return set.plannedWeight ?? null;
    case "distance":
      return set.plannedDistance ?? null;
    case "time":
      return set.plannedTime ?? null;
  }
}

function getChangedPlannedFields(sets: readonly ExerciseSet[]): PlannedMetricField[] {
  return PLANNED_FIELDS.filter((field) =>
    sets.some((set) => {
      const planned = getPlannedValue(set, field);
      return planned != null && planned !== getActualValue(set, field);
    }),
  );
}

function getUniformPlannedValue(
  sets: readonly ExerciseSet[],
  field: PlannedMetricField,
): { value: number | null; varies: boolean } {
  const plannedValues = sets
    .map((set) => getPlannedValue(set, field))
    .filter((value): value is number => value != null);
  if (plannedValues.length === 0) return { value: null, varies: false };
  const first = plannedValues[0];
  return {
    value: first,
    varies: plannedValues.some((value) => value !== first),
  };
}

export function buildPlannedDiffSummary(
  sets: readonly ExerciseSet[],
  weightUnit: "kg" | "lb",
  distanceUnit: "km" | "miles",
): string | null {
  const changedFields = getChangedPlannedFields(sets);
  if (changedFields.length === 0) return null;

  const parts = changedFields
    .map((field) => formatPlannedFieldSummary(sets, field, weightUnit, distanceUnit))
    .filter(Boolean);
  return parts.length > 0 ? `planned ${parts.join(", ")}` : null;
}

function formatPlannedFieldSummary(
  sets: readonly ExerciseSet[],
  field: PlannedMetricField,
  weightUnit: "kg" | "lb",
  distanceUnit: "km" | "miles",
): string | null {
  const planned = getUniformPlannedValue(sets, field);
  if (planned.value == null) return null;
  if (planned.varies) return `${field} varied`;
  if (field === "weight") return `${planned.value} ${weightUnit}`;
  if (field === "distance") return getWorkoutDistanceDisplay(planned.value, distanceUnit).text;
  if (field === "time") return `${planned.value} min`;
  return `${planned.value} reps`;
}

export interface UniformitySummary {
  readonly reps: number | null;
  readonly repsVaries: boolean;
  readonly weight: number | null;
  readonly weightVaries: boolean;
  readonly distance: number | null;
  readonly distanceVaries: boolean;
  readonly time: number | null;
  readonly timeVaries: boolean;
}

export function computeUniformity(sets: readonly ExerciseSet[]): UniformitySummary {
  const first: ExerciseSet | undefined = sets[0];
  return {
    reps: first?.reps ?? null,
    repsVaries: hasVariance(sets, "reps"),
    weight: first?.weight ?? null,
    weightVaries: hasVariance(sets, "weight"),
    distance: first?.distance ?? null,
    distanceVaries: hasVariance(sets, "distance"),
    time: first?.time ?? null,
    timeVaries: hasVariance(sets, "time"),
  };
}

/**
 * True when any set in the group disagrees with the first on this
 * field. Extracted so `computeUniformity` stays under Sonar's
 * cognitive-complexity ceiling.
 */
function hasVariance(
  sets: readonly ExerciseSet[],
  field: "reps" | "weight" | "distance" | "time",
): boolean {
  if (sets.length <= 1) return false;
  const baseline = sets[0][field];
  for (let i = 1; i < sets.length; i++) {
    if (sets[i][field] !== baseline) return true;
  }
  return false;
}

export type PrimaryField = "reps" | "distance" | "time";

export interface PrimaryMetric {
  readonly field: PrimaryField;
  readonly value: number | null;
  readonly varies: boolean;
  readonly label: string;
  readonly suffix?: string;
}

interface MetricMeta {
  readonly label: string;
  readonly suffix?: (distanceUnit: "km" | "miles") => string;
  readonly valueKey: "reps" | "distance" | "time";
  readonly variesKey: "repsVaries" | "distanceVaries" | "timeVaries";
}

const METRIC_META: Readonly<Record<PrimaryField, MetricMeta>> = {
  reps: { label: "Reps", suffix: () => "reps", valueKey: "reps", variesKey: "repsVaries" },
  distance: {
    label: "Distance",
    valueKey: "distance",
    variesKey: "distanceVaries",
  },
  time: { label: "Time", suffix: () => "min", valueKey: "time", variesKey: "timeVaries" },
};

const METRIC_PRIORITY: readonly PrimaryField[] = ["reps", "distance", "time"];

export function buildPrimaryMetric(
  exerciseName: string,
  u: UniformitySummary,
  distanceUnit: "km" | "miles",
): PrimaryMetric {
  const field = pickMetricField(exerciseName, u);
  const meta = METRIC_META[field];
  const value = u[meta.valueKey];
  if (field === "distance" && value != null) {
    const display = getWorkoutDistanceDisplay(value, distanceUnit);
    return {
      field,
      value: display.value,
      varies: u[meta.variesKey],
      label: meta.label,
      suffix: display.unit,
    };
  }
  return {
    field,
    value,
    varies: u[meta.variesKey],
    label: meta.label,
    suffix: meta.suffix?.(distanceUnit),
  };
}

export function pickMetricField(exerciseName: string, u: UniformitySummary): PrimaryField {
  if (exerciseName === "custom") {
    if (u.distance != null) return "distance";
    if (u.time != null) return "time";
    return "reps";
  }
  const fields: readonly FieldKey[] = getFields(exerciseName);
  return METRIC_PRIORITY.find((m) => fields.includes(m)) ?? "reps";
}

export function shouldShowLoad(group: GroupedExercise, primaryField: PrimaryField): boolean {
  const fields = getFields(group.exerciseName);
  if (!fields.includes("weight")) return false;
  if (primaryField === "reps") return true;
  return group.sets.some((s) => s.weight != null);
}

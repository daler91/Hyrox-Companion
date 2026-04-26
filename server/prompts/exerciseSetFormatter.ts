import { EXERCISE_DEFINITIONS, type ExerciseName } from "@shared/schema";

export interface PromptExerciseSet {
  readonly exerciseName: string;
  readonly customLabel?: string | null;
  readonly category?: string | null;
  readonly setNumber?: number | null;
  readonly reps?: number | null;
  readonly weight?: number | null;
  readonly distance?: number | null;
  readonly time?: number | null;
  readonly notes?: string | null;
  readonly sortOrder?: number | null;
}

interface FormatOptions {
  readonly weightUnit?: string | null;
}

interface ExerciseGroup {
  readonly exerciseName: string;
  readonly customLabel?: string | null;
  readonly sets: PromptExerciseSet[];
}

const BOGUS_LABEL_RE = /^\d+\s*[xX]?$/;

function getExerciseLabel(exerciseName: string, customLabel?: string | null): string {
  const trimmed = customLabel?.trim();
  if (trimmed) {
    if (exerciseName === "custom" || exerciseName.startsWith("custom:")) return trimmed;
    if (!BOGUS_LABEL_RE.test(trimmed)) return trimmed;
  }
  if (exerciseName.startsWith("custom:")) return exerciseName.slice(7);
  return EXERCISE_DEFINITIONS[exerciseName as ExerciseName]?.label || exerciseName;
}

function sortSets(sets: readonly PromptExerciseSet[]): PromptExerciseSet[] {
  return [...sets].sort((a, b) => {
    const orderDelta = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    if (orderDelta !== 0) return orderDelta;
    return (a.setNumber ?? 0) - (b.setNumber ?? 0);
  });
}

function groupExerciseSets(sets: readonly PromptExerciseSet[]): ExerciseGroup[] {
  const groups: ExerciseGroup[] = [];
  let currentKey: string | null = null;
  let currentGroup: ExerciseGroup | null = null;

  for (const set of sortSets(sets)) {
    const key = set.exerciseName === "custom" && set.customLabel
      ? `custom:${set.customLabel}`
      : set.exerciseName;
    if (key !== currentKey) {
      currentGroup = {
        exerciseName: set.exerciseName,
        customLabel: set.customLabel,
        sets: [],
      };
      groups.push(currentGroup);
      currentKey = key;
    }
    currentGroup!.sets.push(set);
  }

  return groups;
}

function sameValue<T>(sets: readonly PromptExerciseSet[], pick: (set: PromptExerciseSet) => T): boolean {
  if (sets.length <= 1) return true;
  const first = pick(sets[0]);
  return sets.every((set) => pick(set) === first);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function formatSetMeasurements(set: PromptExerciseSet, weightUnit?: string | null): string {
  const parts: string[] = [];
  if (set.reps != null) parts.push(`${set.reps} reps`);
  if (set.weight != null) parts.push(`${formatNumber(set.weight)} ${weightUnit || "kg"}`);
  if (set.distance != null) parts.push(`${formatNumber(set.distance)}m`);
  if (set.time != null) parts.push(`${formatNumber(set.time)} min`);
  if (set.notes?.trim()) parts.push(`note: ${set.notes.trim()}`);
  return parts.join(", ");
}

function formatGroup(group: ExerciseGroup, options: FormatOptions): string {
  const name = getExerciseLabel(group.exerciseName, group.customLabel);
  const { sets } = group;
  if (sets.length === 0) return name;

  const first = sets[0];
  const allSameReps = sameValue(sets, (set) => set.reps);
  const allSameWeight = sameValue(sets, (set) => set.weight);
  const allSameDistance = sameValue(sets, (set) => set.distance);
  const allSameTime = sameValue(sets, (set) => set.time);
  const allSameNotes = sameValue(sets, (set) => set.notes?.trim() || null);
  const canCollapse = sets.length > 1 && allSameReps && allSameWeight && allSameDistance && allSameTime && allSameNotes;

  if (canCollapse) {
    const measurements = formatSetMeasurements(first, options.weightUnit);
    return measurements ? `${name}: ${sets.length} sets x ${measurements}` : `${name}: ${sets.length} sets`;
  }

  if (sets.length === 1) {
    const measurements = formatSetMeasurements(first, options.weightUnit);
    return measurements ? `${name}: ${measurements}` : name;
  }

  const setParts = sets.map((set) => {
    const measurements = formatSetMeasurements(set, options.weightUnit);
    return measurements ? `set ${set.setNumber ?? "?"}: ${measurements}` : `set ${set.setNumber ?? "?"}`;
  });
  return `${name}: ${setParts.join("; ")}`;
}

export function formatExerciseSetsForPrompt(
  sets: readonly PromptExerciseSet[] | null | undefined,
  options: FormatOptions = {},
): string {
  if (!sets || sets.length === 0) return "";
  return groupExerciseSets(sets)
    .map((group) => formatGroup(group, options))
    .join(" | ");
}

export function buildWorkoutSearchText(
  workout: {
    readonly focus?: string | null;
    readonly mainWorkout?: string | null;
    readonly accessory?: string | null;
    readonly notes?: string | null;
    readonly exerciseDetails?: readonly PromptExerciseSet[] | null;
  },
  options: FormatOptions = {},
): string {
  const exerciseSummary = formatExerciseSetsForPrompt(workout.exerciseDetails, options);
  const details = exerciseSummary
    ? [`Exercises: ${exerciseSummary}`]
    : [workout.mainWorkout, workout.accessory, workout.notes];
  return [workout.focus, ...details]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ");
}

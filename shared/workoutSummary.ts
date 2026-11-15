/**
 * The text a workout gets when the athlete builds it from exercise rows and
 * writes none of their own: "Back Squat: 5x5, 100kg; Easy Run: 5000 m".
 *
 * The web's composer wrote it before saving; POST /api/v1/workouts now writes
 * it when `mainWorkout` is left out or blank, so the app sends the rows alone
 * rather than copying these rules (docs/mobile-shared-logic.md, API field 11).
 * Set values are in the athlete's units, as the request carries them.
 */
import { EXERCISE_DEFINITIONS } from "./schema/exercises";
import { getWorkoutDistanceDisplay } from "./unitConversion";
import { formatMinutes, minutes } from "./units";

/** A set as the summary reads it. */
export interface SummarySet {
  readonly reps?: number | null;
  readonly weight?: number | null;
  readonly distance?: number | null;
  readonly time?: number | null;
  readonly notes?: string | null;
}

/** An exercise as the summary reads it. */
export interface SummaryExercise {
  readonly exerciseName: string;
  readonly customLabel?: string | null;
  readonly sets?: readonly SummarySet[] | null;
}

function areSetsUniform(sets: readonly SummarySet[]): boolean {
  if (sets.length <= 1) return true;
  const firstSet = sets[0];
  for (let i = 1; i < sets.length; i++) {
    if (sets[i].reps !== firstSet.reps || sets[i].weight !== firstSet.weight) {
      return false;
    }
  }
  return true;
}

function exerciseLabel(ex: SummaryExercise): string {
  if (ex.exerciseName === "custom" && ex.customLabel) return ex.customLabel;
  const definitions: Readonly<Record<string, { readonly label?: string } | undefined>> = EXERCISE_DEFINITIONS;
  const def = Object.hasOwn(definitions, ex.exerciseName) ? definitions[ex.exerciseName] : undefined;
  return def?.label || ex.exerciseName;
}

function formatExerciseSummary(ex: SummaryExercise, weightUnit: string, distanceUnit: string): string {
  const name = exerciseLabel(ex);
  const sets = ex.sets || [];

  if (sets.length === 0) {
    return `${name}: completed`;
  }

  const firstSet = sets[0];
  const allSame = areSetsUniform(sets);

  const parts: string[] = [];
  if (allSame && sets.length > 1 && firstSet.reps) {
    parts.push(`${sets.length}x${firstSet.reps}`);
  } else if (firstSet.reps) {
    parts.push(`${sets.length > 1 ? sets.length + " sets, " : ""}${firstSet.reps} reps`);
  } else if (sets.length > 1) {
    parts.push(`${sets.length} sets`);
  }

  if (allSame && firstSet.weight) parts.push(`${firstSet.weight}${weightUnit}`);
  if (firstSet.distance) parts.push(getWorkoutDistanceDisplay(firstSet.distance, distanceUnit).text);
  if (firstSet.time) parts.push(formatMinutes(minutes(firstSet.time)));

  return `${name}: ${parts.join(", ") || "completed"}`;
}

/**
 * One clause per exercise, joined with "; ". When any set carries a cue, each
 * exercise also lists its steps: "Row: 4x500 m [S1 -> S2(cue: hold 1:50) -> …]".
 */
export function generateSummary(exercises: readonly SummaryExercise[], weightUnit: string, distanceUnit: string): string {
  const hasStructuredHints = exercises.some((ex) => (ex.sets || []).some((set) => Boolean(set.notes)));
  if (!hasStructuredHints) {
    const summaries: string[] = [];
    for (const ex of exercises) summaries.push(formatExerciseSummary(ex, weightUnit, distanceUnit));
    return summaries.join("; ");
  }

  const blocks: string[] = [];
  for (const ex of exercises) {
    const headline = formatExerciseSummary(ex, weightUnit, distanceUnit);
    const steps = (ex.sets || []).map((set, idx) => {
      const stepLabel = `S${idx + 1}`;
      if (!set.notes) return stepLabel;
      return `${stepLabel}(cue: ${set.notes})`;
    });
    blocks.push(steps.length > 0 ? `${headline} [${steps.join(" -> ")}]` : headline);
  }
  return blocks.join("; ");
}

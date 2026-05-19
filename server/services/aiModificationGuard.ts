import { createHash } from "node:crypto";

import type { CoachNoteInputs, ExerciseSet, InsertExerciseSet } from "@shared/schema";

import type { TrainingContext, UpcomingWorkout } from "../gemini";

type CoachModificationKind = NonNullable<CoachNoteInputs["lastModification"]>["kind"];
type RpeTrend = NonNullable<CoachNoteInputs["rpeTrend"]>;

export interface CoachModificationSignals {
  readonly completedWorkouts?: number;
  readonly coachingInsights?: {
    readonly fatigueFlag?: boolean;
    readonly rpeTrend?: RpeTrend;
  };
}

export interface CoachModificationInput {
  readonly workoutId?: string;
  readonly targetField?: "mainWorkout" | "accessory" | "notes";
  readonly action?: "replace" | "append";
  readonly recommendation?: string;
  readonly rationale?: string | null;
}

type CoachModificationMetadata = NonNullable<CoachNoteInputs["lastModification"]>;
type CoachFatigueReductionMetadata = NonNullable<CoachNoteInputs["lastFatigueReduction"]>;

type WorkoutPrescriptionInput = Pick<
  UpcomingWorkout,
  "mainWorkout" | "accessory" | "notes" | "exerciseDetails"
>;
type ExerciseDetail = NonNullable<UpcomingWorkout["exerciseDetails"]>[number];
type WorkoutTextField = "mainWorkout" | "accessory" | "notes";

const FATIGUE_TERMS = [
  "fatigue",
  "rpe",
  "recovery",
  "recover",
  "overworked",
  "overreached",
  "overtraining",
  "soreness",
  "tired",
];

const REDUCTION_TERMS = [
  "reduce",
  "reduced",
  "reducing",
  "lower",
  "lighter",
  "scale",
  "scaled",
  "deload",
  "shorter",
  "fewer",
  "less",
  "easier",
  "easy",
  "decrease",
  "cut",
];

function textIncludesAny(text: string, terms: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function hasActiveFatigueSignal(signals: CoachModificationSignals): boolean {
  return Boolean(
    signals.coachingInsights?.fatigueFlag || signals.coachingInsights?.rpeTrend === "rising",
  );
}

function buildSuggestionText(suggestion: CoachModificationInput): string {
  return `${suggestion.rationale ?? ""} ${suggestion.recommendation ?? ""}`;
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized || null;
}

function normalizeExerciseDetails(workout: WorkoutPrescriptionInput) {
  // ⚡ Bolt Performance Optimization:
  // Using a Schwartzian transform (decorate-sort-undecorate) to pre-compute stringified keys in O(N) time.
  // This avoids O(N log N) expensive JSON.stringify() operations inside the sort comparator.
  return (workout.exerciseDetails ?? [])
    .map((exercise) => {
      const item = {
        exerciseName: normalizeText(exercise.exerciseName),
        customLabel: normalizeText(exercise.customLabel),
        category: normalizeText(exercise.category),
        setNumber: exercise.setNumber ?? null,
        reps: exercise.reps ?? null,
        weight: exercise.weight ?? null,
        distance: exercise.distance ?? null,
        time: exercise.time ?? null,
        notes: normalizeText(exercise.notes),
      };
      return { item, key: JSON.stringify(item) };
    })
    .sort((a, b) => {
      if (a.key < b.key) return -1;
      if (a.key > b.key) return 1;
      return 0;
    })
    .map(({ item }) => item);
}

export function mapExerciseSetToPromptDetail(row: ExerciseSet | InsertExerciseSet): ExerciseDetail {
  return {
    exerciseName: row.exerciseName,
    customLabel: row.customLabel ?? null,
    category: row.category,
    setNumber: row.setNumber ?? null,
    reps: row.reps ?? null,
    weight: row.weight ?? null,
    distance: row.distance ?? null,
    time: row.time ?? null,
    notes: row.notes ?? null,
    sortOrder: row.sortOrder ?? null,
  };
}

export function buildStructuredResultingWorkout(
  entry: UpcomingWorkout,
  action: "replace" | "append",
  structuredRows: InsertExerciseSet[],
): UpcomingWorkout {
  const structuredDetails = structuredRows.map(mapExerciseSetToPromptDetail);
  return {
    ...entry,
    exerciseDetails:
      action === "append"
        ? [...(entry.exerciseDetails ?? []), ...structuredDetails]
        : structuredDetails,
  };
}

export function buildTextResultingWorkout(
  entry: UpcomingWorkout,
  targetField: WorkoutTextField,
  updatedValue: string,
): UpcomingWorkout {
  return {
    ...entry,
    [targetField]: updatedValue,
  };
}

export function buildWorkoutPrescriptionFingerprint(
  workout: WorkoutPrescriptionInput | null | undefined,
): string | undefined {
  if (!workout) return undefined;

  const payload = {
    mainWorkout: normalizeText(workout.mainWorkout),
    accessory: normalizeText(workout.accessory),
    notes: normalizeText(workout.notes),
    exerciseDetails: normalizeExerciseDetails(workout),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function resolvePriorFatigueReduction(
  inputsUsed: CoachNoteInputs | null | undefined,
): CoachFatigueReductionMetadata | undefined {
  if (inputsUsed?.lastFatigueReduction?.kind === "fatigue_volume_reduction") {
    return inputsUsed.lastFatigueReduction;
  }

  if (inputsUsed?.lastModification?.kind === "fatigue_volume_reduction") {
    return {
      ...inputsUsed.lastModification,
      kind: "fatigue_volume_reduction",
    };
  }

  return undefined;
}

export function classifyCoachModification(
  suggestion: CoachModificationInput,
  signals: CoachModificationSignals,
): CoachModificationKind | null {
  if (suggestion.targetField === "notes") return null;
  if (!suggestion.recommendation?.trim()) return null;

  const text = buildSuggestionText(suggestion);
  if (
    hasActiveFatigueSignal(signals) &&
    textIncludesAny(text, FATIGUE_TERMS) &&
    textIncludesAny(text, REDUCTION_TERMS)
  ) {
    return "fatigue_volume_reduction";
  }

  return "workload_adjustment";
}

export function shouldSuppressRepeatedFatigueReduction(
  suggestion: CoachModificationInput,
  workout: UpcomingWorkout | undefined,
  signals: CoachModificationSignals,
): boolean {
  if (classifyCoachModification(suggestion, signals) !== "fatigue_volume_reduction") {
    return false;
  }

  const priorFatigueReduction = resolvePriorFatigueReduction(workout?.aiInputsUsed);
  if (!priorFatigueReduction) {
    return false;
  }

  const currentCompletedWorkouts = signals.completedWorkouts ?? 0;
  const completedAtLastModification = priorFatigueReduction.completedWorkoutCount;
  if (
    completedAtLastModification != null &&
    currentCompletedWorkouts > completedAtLastModification
  ) {
    return false;
  }

  const currentFingerprint = buildWorkoutPrescriptionFingerprint(workout);
  return Boolean(
    priorFatigueReduction.prescriptionFingerprint &&
    currentFingerprint === priorFatigueReduction.prescriptionFingerprint,
  );
}

export function withCoachModificationMetadata(
  inputsUsed: CoachNoteInputs,
  suggestion: CoachModificationInput,
  signals: CoachModificationSignals,
  resultingWorkout?: WorkoutPrescriptionInput,
): CoachNoteInputs {
  const kind = classifyCoachModification(suggestion, signals);
  if (!kind) return inputsUsed;

  const modification: CoachModificationMetadata = {
    kind,
    reason: suggestion.rationale?.slice(0, 400) || undefined,
    at: new Date().toISOString(),
    completedWorkoutCount: signals.completedWorkouts,
    fatigueFlag: signals.coachingInsights?.fatigueFlag,
    rpeTrend: signals.coachingInsights?.rpeTrend,
    prescriptionFingerprint: buildWorkoutPrescriptionFingerprint(resultingWorkout),
  };

  return {
    ...inputsUsed,
    completedWorkoutCount: signals.completedWorkouts,
    lastModification: modification,
    lastFatigueReduction:
      kind === "fatigue_volume_reduction"
        ? { ...modification, kind: "fatigue_volume_reduction" }
        : (inputsUsed.lastFatigueReduction ?? resolvePriorFatigueReduction(inputsUsed)),
  };
}

export function buildSignalsFromTrainingContext(
  trainingContext: TrainingContext,
): CoachModificationSignals {
  return {
    completedWorkouts: trainingContext.completedWorkouts,
    coachingInsights: trainingContext.coachingInsights,
  };
}

export function buildSignalsFromCoachInputs(
  inputsUsed: CoachNoteInputs | null | undefined,
): CoachModificationSignals {
  return {
    completedWorkouts:
      inputsUsed?.completedWorkoutCount ??
      inputsUsed?.lastModification?.completedWorkoutCount ??
      inputsUsed?.lastFatigueReduction?.completedWorkoutCount,
    coachingInsights: {
      fatigueFlag:
        inputsUsed?.fatigueFlag ??
        inputsUsed?.lastModification?.fatigueFlag ??
        inputsUsed?.lastFatigueReduction?.fatigueFlag,
      rpeTrend:
        inputsUsed?.rpeTrend ??
        inputsUsed?.lastModification?.rpeTrend ??
        inputsUsed?.lastFatigueReduction?.rpeTrend,
    },
  };
}

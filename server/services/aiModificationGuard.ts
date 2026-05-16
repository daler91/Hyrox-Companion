import type { CoachNoteInputs } from "@shared/schema";

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
  readonly recommendation?: string;
  readonly rationale?: string | null;
}

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

  const lastModification = workout?.aiInputsUsed?.lastModification;
  if (lastModification?.kind !== "fatigue_volume_reduction") {
    return false;
  }

  const currentCompletedWorkouts = signals.completedWorkouts ?? 0;
  const completedAtLastModification = lastModification.completedWorkoutCount;
  return (
    completedAtLastModification == null || currentCompletedWorkouts <= completedAtLastModification
  );
}

export function withCoachModificationMetadata(
  inputsUsed: CoachNoteInputs,
  suggestion: CoachModificationInput,
  signals: CoachModificationSignals,
): CoachNoteInputs {
  const kind = classifyCoachModification(suggestion, signals);
  if (!kind) return inputsUsed;

  return {
    ...inputsUsed,
    completedWorkoutCount: signals.completedWorkouts,
    lastModification: {
      kind,
      reason: suggestion.rationale?.slice(0, 400) || undefined,
      at: new Date().toISOString(),
      completedWorkoutCount: signals.completedWorkouts,
      fatigueFlag: signals.coachingInsights?.fatigueFlag,
      rpeTrend: signals.coachingInsights?.rpeTrend,
    },
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
      inputsUsed?.completedWorkoutCount ?? inputsUsed?.lastModification?.completedWorkoutCount,
    coachingInsights: {
      fatigueFlag: inputsUsed?.fatigueFlag,
      rpeTrend: inputsUsed?.rpeTrend,
    },
  };
}

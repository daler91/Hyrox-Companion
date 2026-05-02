import type { TrainingContext, UpcomingWorkout, WorkoutSuggestion } from "../../gemini";

import type { ResolvedTrainingStyle, TrainingStyleStrategy } from "./types";

const DEFAULT_TRAINING_STYLE_ID = "balanced_default";

const defaultStrategy: TrainingStyleStrategy = {
  id: DEFAULT_TRAINING_STYLE_ID,
  computeProfile(trainingContext: TrainingContext) {
    return {
      completionRate: trainingContext.completionRate,
      currentStreak: trainingContext.currentStreak,
      rpeTrend: trainingContext.coachingInsights?.rpeTrend ?? "insufficient_data",
    };
  },
  analyzeWorkout(_trainingContext: TrainingContext, upcomingWorkouts: UpcomingWorkout[]) {
    return `Review ${upcomingWorkouts.length} upcoming workouts and prioritize sustainable progression.`;
  },
  prescribeNext(input: { suggestions: WorkoutSuggestion[]; trainingContext: TrainingContext }) {
    return input.suggestions;
  },
  phaseLogic(trainingContext: TrainingContext) {
    return trainingContext.coachingInsights?.planPhase
      ? `Follow ${trainingContext.coachingInsights.planPhase.phaseLabel} phase intent.`
      : "Use conservative progression when plan phase is unknown.";
  },
  safetyRules(trainingContext: TrainingContext) {
    return trainingContext.coachingInsights?.fatigueFlag
      ? ["Reduce intensity/volume when fatigue flag is active."]
      : ["Avoid sudden spikes in intensity or volume."];
  },
  buildPromptContext(trainingContext: TrainingContext, upcomingWorkouts: UpcomingWorkout[]) {
    return {
      promptSuffix: [
        `Training style: balanced_default`,
        this.analyzeWorkout(trainingContext, upcomingWorkouts),
        `Phase logic: ${this.phaseLogic(trainingContext)}`,
        `Safety rules: ${this.safetyRules(trainingContext).join(" ")}`,
      ].join("\n"),
    };
  },
};

const mafMethodStrategy: TrainingStyleStrategy = {
  ...defaultStrategy,
  id: "maf_method",
  buildPromptContext(trainingContext: TrainingContext, upcomingWorkouts: UpcomingWorkout[]) {
    return {
      promptSuffix: [
        `Training style: maf_method`,
        `Bias recommendations toward aerobic base building and controlled intensity.`,
        this.analyzeWorkout(trainingContext, upcomingWorkouts),
        `Safety rules: Keep hard efforts constrained when fatigue signals rise.`,
      ].join("\n"),
    };
  },
};

const strategies = new Map<string, TrainingStyleStrategy>([
  [defaultStrategy.id, defaultStrategy],
  [mafMethodStrategy.id, mafMethodStrategy],
]);

export function resolveTrainingStyle(trainingStyleId?: string | null): ResolvedTrainingStyle {
  const strategy = (trainingStyleId && strategies.get(trainingStyleId)) || strategies.get(DEFAULT_TRAINING_STYLE_ID)!;
  return { trainingStyleId: strategy.id, strategy };
}

export { DEFAULT_TRAINING_STYLE_ID };

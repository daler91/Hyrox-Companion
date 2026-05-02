import type { TrainingContext, UpcomingWorkout, WorkoutSuggestion } from "../../gemini";

export interface TrainingStylePromptContext {
  promptPrefix?: string;
  promptSuffix?: string;
  systemInstructionAppendix?: string;
}

export interface TrainingStyleStrategy {
  id: string;
  computeProfile(trainingContext: TrainingContext): Record<string, unknown>;
  analyzeWorkout(trainingContext: TrainingContext, upcomingWorkouts: UpcomingWorkout[]): string;
  prescribeNext(input: { suggestions: WorkoutSuggestion[]; trainingContext: TrainingContext }): WorkoutSuggestion[];
  phaseLogic(trainingContext: TrainingContext): string;
  safetyRules(trainingContext: TrainingContext): string[];
  buildPromptContext(trainingContext: TrainingContext, upcomingWorkouts: UpcomingWorkout[]): TrainingStylePromptContext;
}

export interface ResolvedTrainingStyle {
  trainingStyleId: string;
  strategy: TrainingStyleStrategy;
}

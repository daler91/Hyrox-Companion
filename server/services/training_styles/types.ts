import type { TrainingContext, UpcomingWorkout } from "../../gemini";

export interface TrainingStylePromptContext {
  promptPrefix?: string;
  promptSuffix?: string;
  systemInstructionAppendix?: string;
}

/**
 * What a training style changes: the coach prompt, nothing else. The interface
 * also declared computeProfile, analyzeWorkout, phaseLogic, safetyRules and
 * prescribeNext; nothing called the first four, and prescribeNext returned the
 * suggestions unchanged for every style, so they were dropped
 * (S-trainingStyles, REFACTORING_REVIEW 2026-09-23).
 */
export interface TrainingStyleStrategy {
  id: string;
  buildPromptContext(trainingContext: TrainingContext, upcomingWorkouts: UpcomingWorkout[]): TrainingStylePromptContext;
}

export interface ResolvedTrainingStyle {
  trainingStyleId: string;
  strategy: TrainingStyleStrategy;
}

export { classifyWorkoutCompliance, summarizeSetAdherence } from "./workoutService/adherence";
export { saveParsedWorkout, saveParsedWorkoutsBatch } from "./workoutService/persistence";
export type { ReparseFromImageInput } from "./workoutService/reparse";
export {
  autoHydrateExerciseSetsFromTextIfNeeded,
  batchReparseWorkouts,
  processBatchChunk,
  reparsePlanDay,
  reparsePlanDayFromImage,
  reparseWorkout,
  reparseWorkoutFromImage,
} from "./workoutService/reparse";
export {
  expandExercisesToPlanDaySetRows,
  expandExercisesToSetRows,
  extractAndDeduplicateCustomExercises,
  prepareParsedWorkout,
} from "./workoutService/setRows";
export {
  deriveMissingPlanDaySetsFromStructure,
  deriveMissingWorkoutSetsFromStructure,
  replacePlanDayStructure,
  resolveStructureStepTimeTarget,
  shouldDeriveStructureExerciseSets,
  updateWorkoutStructureBlockScore,
} from "./workoutService/structure";
export type { CreateWorkoutResult, UpdateWorkoutResult } from "./workoutService/types";
export { assignWorkoutPlanDay, createWorkout, createWorkoutAndScheduleCoaching, isDateWithinPlanWindow, updateWorkout } from "./workoutService/workouts";

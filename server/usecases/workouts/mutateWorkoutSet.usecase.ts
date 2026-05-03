import { type AddExerciseSetBody, type PatchExerciseSetBody } from "@shared/schema";

import { createMutateExerciseSetUseCase } from "./mutateExerciseSet.usecase";

export interface WorkoutSetStorage {
  updateExerciseSet: (workoutId: string, setId: string, body: PatchExerciseSetBody, userId: string) => Promise<unknown>;
  addExerciseSetToWorkoutLog: (workoutId: string, body: AddExerciseSetBody, userId: string) => Promise<unknown>;
  deleteExerciseSet: (workoutId: string, setId: string, userId: string) => Promise<boolean>;
}

export const createMutateWorkoutSetUseCase = (storage: WorkoutSetStorage) => createMutateExerciseSetUseCase({
  updateSet: (workoutId, setId, body, userId) => storage.updateExerciseSet(workoutId, setId, body, userId),
  addSet: (workoutId, body, userId) => storage.addExerciseSetToWorkoutLog(workoutId, body, userId),
  deleteSet: (workoutId, setId, userId) => storage.deleteExerciseSet(workoutId, setId, userId),
});

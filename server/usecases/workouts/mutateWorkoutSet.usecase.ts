import { type AddExerciseSetBody, type PatchExerciseSetBody } from "@shared/schema";

import { createMutateExerciseSetUseCase } from "./mutateExerciseSet.usecase";

export interface WorkoutSetStorage {
  updateExerciseSet: (workoutId: string, setId: string, body: PatchExerciseSetBody, userId: string) => Promise<unknown>;
  addExerciseSetToWorkoutLog: (workoutId: string, body: AddExerciseSetBody, userId: string) => Promise<unknown>;
  deleteExerciseSet: (workoutId: string, setId: string, userId: string) => Promise<boolean>;
}

export const createMutateWorkoutSetUseCase = (storage: WorkoutSetStorage) => createMutateExerciseSetUseCase({
  updateSet: (owner, setId, body, userId) => storage.updateExerciseSet(owner.ownerId, setId, body, userId),
  addSet: (owner, body, userId) => storage.addExerciseSetToWorkoutLog(owner.ownerId, body, userId),
  deleteSet: (owner, setId, userId) => storage.deleteExerciseSet(owner.ownerId, setId, userId),
});

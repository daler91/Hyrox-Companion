import { type AddExerciseSetBody, type PatchExerciseSetBody } from "@shared/schema";

export interface WorkoutSetStorage {
  updateExerciseSet: (workoutId: string, setId: string, body: PatchExerciseSetBody, userId: string) => Promise<unknown>;
  addExerciseSetToWorkoutLog: (workoutId: string, body: AddExerciseSetBody, userId: string) => Promise<unknown>;
  deleteExerciseSet: (workoutId: string, setId: string, userId: string) => Promise<boolean>;
}

export const createMutateWorkoutSetUseCase = (storage: WorkoutSetStorage) => ({
  updateSet: (workoutId: string, setId: string, body: PatchExerciseSetBody, userId: string) =>
    storage.updateExerciseSet(workoutId, setId, body, userId),
  addSet: (workoutId: string, body: AddExerciseSetBody, userId: string) =>
    storage.addExerciseSetToWorkoutLog(workoutId, body, userId),
  deleteSet: (workoutId: string, setId: string, userId: string) =>
    storage.deleteExerciseSet(workoutId, setId, userId),
});

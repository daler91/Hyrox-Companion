import { type AddExerciseSetBody, type PatchExerciseSetBody } from "@shared/schema";

import { createMutateExerciseSetByOwnerUseCase, type ExerciseSetOwnerStorage } from "./mutateExerciseSetByOwner.usecase";

export type WorkoutSetStorage = Pick<
  ExerciseSetOwnerStorage,
  "updateExerciseSet" | "addExerciseSetToWorkoutLog" | "deleteExerciseSet"
>;

export const createMutateWorkoutSetUseCase = (storage: WorkoutSetStorage) => {
  const ownerUseCase = createMutateExerciseSetByOwnerUseCase({
    ...storage,
    updateExerciseSetForPlanDay: async () => null,
    addExerciseSetToPlanDay: async () => null,
    deleteExerciseSetForPlanDay: async () => false,
  });

  return {
    updateSet: (workoutId: string, setId: string, body: PatchExerciseSetBody, userId: string) =>
      ownerUseCase.updateSet({ kind: "workoutLog", id: workoutId }, setId, body, userId),
    addSet: (workoutId: string, body: AddExerciseSetBody, userId: string) =>
      ownerUseCase.addSet({ kind: "workoutLog", id: workoutId }, body, userId),
    deleteSet: (workoutId: string, setId: string, userId: string) =>
      ownerUseCase.deleteSet({ kind: "workoutLog", id: workoutId }, setId, userId),
  };
};

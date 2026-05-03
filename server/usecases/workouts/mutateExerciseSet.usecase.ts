import { type AddExerciseSetBody, type PatchExerciseSetBody } from "@shared/schema";

export interface ExerciseSetMutationStorage {
  updateSet: (ownerId: string, setId: string, body: PatchExerciseSetBody, userId: string) => Promise<unknown>;
  addSet: (ownerId: string, body: AddExerciseSetBody, userId: string) => Promise<unknown>;
  deleteSet: (ownerId: string, setId: string, userId: string) => Promise<boolean>;
}

export const createMutateExerciseSetUseCase = (storage: ExerciseSetMutationStorage) => ({
  updateSet: (ownerId: string, setId: string, body: PatchExerciseSetBody, userId: string) => storage.updateSet(ownerId, setId, body, userId),
  addSet: (ownerId: string, body: AddExerciseSetBody, userId: string) => storage.addSet(ownerId, body, userId),
  deleteSet: (ownerId: string, setId: string, userId: string) => storage.deleteSet(ownerId, setId, userId),
});

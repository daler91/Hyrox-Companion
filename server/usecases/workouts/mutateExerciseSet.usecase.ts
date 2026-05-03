import { type AddExerciseSetBody, type PatchExerciseSetBody } from "@shared/schema";

export type ExerciseSetOwnerKind = "workoutLog" | "planDay";

export type ExerciseSetOwnerRef = {
  kind: ExerciseSetOwnerKind;
  ownerId: string;
};

export interface ExerciseSetMutationStorage {
  updateSet: (owner: ExerciseSetOwnerRef, setId: string, body: PatchExerciseSetBody, userId: string) => Promise<unknown>;
  addSet: (owner: ExerciseSetOwnerRef, body: AddExerciseSetBody, userId: string) => Promise<unknown>;
  deleteSet: (owner: ExerciseSetOwnerRef, setId: string, userId: string) => Promise<boolean>;
}

export const createMutateExerciseSetUseCase = (storage: ExerciseSetMutationStorage) => ({
  updateSet: (owner: ExerciseSetOwnerRef, setId: string, body: PatchExerciseSetBody, userId: string) => storage.updateSet(owner, setId, body, userId),
  addSet: (owner: ExerciseSetOwnerRef, body: AddExerciseSetBody, userId: string) => storage.addSet(owner, body, userId),
  deleteSet: (owner: ExerciseSetOwnerRef, setId: string, userId: string) => storage.deleteSet(owner, setId, userId),
});

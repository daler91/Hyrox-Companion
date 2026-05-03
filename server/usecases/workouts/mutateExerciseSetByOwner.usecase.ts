import { type AddExerciseSetBody, type PatchExerciseSetBody } from "@shared/schema";

export type ExerciseSetOwner =
  | { kind: "workoutLog"; id: string }
  | { kind: "planDay"; id: string };

export interface ExerciseSetOwnerStorage {
  updateExerciseSet: (workoutId: string, setId: string, body: PatchExerciseSetBody, userId: string) => Promise<unknown>;
  addExerciseSetToWorkoutLog: (workoutId: string, body: AddExerciseSetBody, userId: string) => Promise<unknown>;
  deleteExerciseSet: (workoutId: string, setId: string, userId: string) => Promise<boolean>;
  updateExerciseSetForPlanDay: (planDayId: string, setId: string, body: PatchExerciseSetBody, userId: string) => Promise<unknown>;
  addExerciseSetToPlanDay: (planDayId: string, body: AddExerciseSetBody, userId: string) => Promise<unknown>;
  deleteExerciseSetForPlanDay: (planDayId: string, setId: string, userId: string) => Promise<boolean>;
}

export const createMutateExerciseSetByOwnerUseCase = (storage: ExerciseSetOwnerStorage) => ({
  updateSet: (owner: ExerciseSetOwner, setId: string, body: PatchExerciseSetBody, userId: string) =>
    owner.kind === "workoutLog"
      ? storage.updateExerciseSet(owner.id, setId, body, userId)
      : storage.updateExerciseSetForPlanDay(owner.id, setId, body, userId),

  addSet: (owner: ExerciseSetOwner, body: AddExerciseSetBody, userId: string) =>
    owner.kind === "workoutLog"
      ? storage.addExerciseSetToWorkoutLog(owner.id, body, userId)
      : storage.addExerciseSetToPlanDay(owner.id, body, userId),

  deleteSet: (owner: ExerciseSetOwner, setId: string, userId: string) =>
    owner.kind === "workoutLog"
      ? storage.deleteExerciseSet(owner.id, setId, userId)
      : storage.deleteExerciseSetForPlanDay(owner.id, setId, userId),
});

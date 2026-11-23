import { storage } from "../../storage";
import { createMutateExerciseSetUseCase } from "../../usecases/workouts/mutateExerciseSet.usecase";

/**
 * The exercise-set use case on the app's storage. Shared by the workout-set
 * routes (workoutsCrud.routes.ts) and the plan-day set routes (plans.ts),
 * which wired it identically in two places (C-routeWiring,
 * REFACTORING_REVIEW 2026-09-23).
 */
export const exerciseSetUseCase = createMutateExerciseSetUseCase({
  updateSet: (owner, setId, body, userId) => storage.workouts.mutateExerciseSetUpdate(owner, setId, body, userId),
  addSet: (owner, body, userId) => storage.workouts.mutateExerciseSetAdd(owner, body, userId),
  deleteSet: (owner, setId, userId) => storage.workouts.mutateExerciseSetDelete(owner, setId, userId),
  getUnitPreferences: async (userId) => {
    const user = await storage.users.getUser(userId);
    return { weightUnit: user?.weightUnit, distanceUnit: user?.distanceUnit };
  },
});

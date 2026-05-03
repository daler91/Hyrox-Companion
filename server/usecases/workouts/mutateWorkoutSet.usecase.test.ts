import { describe, expect, it, vi } from "vitest";

import { createMutateWorkoutSetUseCase } from "./mutateWorkoutSet.usecase";

describe("createMutateWorkoutSetUseCase", () => {
  it("routes add/update/delete through injected storage", async () => {
    const storage = {
      updateExerciseSet: vi.fn().mockResolvedValue({ id: "set-1" }),
      addExerciseSetToWorkoutLog: vi.fn().mockResolvedValue({ id: "set-2" }),
      deleteExerciseSet: vi.fn().mockResolvedValue(true),
    };
    const useCase = createMutateWorkoutSetUseCase(storage);

    await useCase.updateSet("workout-1", "set-1", { reps: 5 } as never, "user-1");
    await useCase.addSet("workout-1", { exerciseName: "Run" } as never, "user-1");
    await useCase.deleteSet("workout-1", "set-1", "user-1");

    expect(storage.updateExerciseSet).toHaveBeenCalled();
    expect(storage.addExerciseSetToWorkoutLog).toHaveBeenCalled();
    expect(storage.deleteExerciseSet).toHaveBeenCalled();
  });
});

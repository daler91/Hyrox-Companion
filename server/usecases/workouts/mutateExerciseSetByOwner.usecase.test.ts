import { describe, expect, it, vi } from "vitest";

import { createMutateExerciseSetByOwnerUseCase } from "./mutateExerciseSetByOwner.usecase";

describe("createMutateExerciseSetByOwnerUseCase", () => {
  it("routes workout-log owner add/update/delete through workout storage methods", async () => {
    const storage = {
      updateExerciseSet: vi.fn().mockResolvedValue({ id: "set-1" }),
      addExerciseSetToWorkoutLog: vi.fn().mockResolvedValue({ id: "set-2" }),
      deleteExerciseSet: vi.fn().mockResolvedValue(true),
      updateExerciseSetForPlanDay: vi.fn(),
      addExerciseSetToPlanDay: vi.fn(),
      deleteExerciseSetForPlanDay: vi.fn(),
    };

    const useCase = createMutateExerciseSetByOwnerUseCase(storage as never);
    const owner = { kind: "workoutLog", id: "workout-1" } as const;
    await useCase.updateSet(owner, "set-1", { reps: 5 } as never, "user-1");
    await useCase.addSet(owner, { exerciseName: "Run" } as never, "user-1");
    await useCase.deleteSet(owner, "set-1", "user-1");

    expect(storage.updateExerciseSet).toHaveBeenCalled();
    expect(storage.addExerciseSetToWorkoutLog).toHaveBeenCalled();
    expect(storage.deleteExerciseSet).toHaveBeenCalled();
    expect(storage.updateExerciseSetForPlanDay).not.toHaveBeenCalled();
    expect(storage.addExerciseSetToPlanDay).not.toHaveBeenCalled();
    expect(storage.deleteExerciseSetForPlanDay).not.toHaveBeenCalled();
  });

  it("routes plan-day owner add/update/delete through plan-day storage methods", async () => {
    const storage = {
      updateExerciseSet: vi.fn(),
      addExerciseSetToWorkoutLog: vi.fn(),
      deleteExerciseSet: vi.fn(),
      updateExerciseSetForPlanDay: vi.fn().mockResolvedValue({ id: "set-1" }),
      addExerciseSetToPlanDay: vi.fn().mockResolvedValue({ id: "set-2" }),
      deleteExerciseSetForPlanDay: vi.fn().mockResolvedValue(true),
    };

    const useCase = createMutateExerciseSetByOwnerUseCase(storage as never);
    const owner = { kind: "planDay", id: "plan-day-1" } as const;
    await useCase.updateSet(owner, "set-1", { reps: 5 } as never, "user-1");
    await useCase.addSet(owner, { exerciseName: "Run" } as never, "user-1");
    await useCase.deleteSet(owner, "set-1", "user-1");

    expect(storage.updateExerciseSetForPlanDay).toHaveBeenCalled();
    expect(storage.addExerciseSetToPlanDay).toHaveBeenCalled();
    expect(storage.deleteExerciseSetForPlanDay).toHaveBeenCalled();
    expect(storage.updateExerciseSet).not.toHaveBeenCalled();
    expect(storage.addExerciseSetToWorkoutLog).not.toHaveBeenCalled();
    expect(storage.deleteExerciseSet).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";

import { createMutateExerciseSetUseCase } from "./mutateExerciseSet.usecase";

describe("createMutateExerciseSetUseCase", () => {
  it.each(["workoutLog", "planDay"] as const)("routes add/update/delete for %s owners identically", async (kind) => {
    const preferences = { weightUnit: "kg", distanceUnit: "km" };
    const storage = {
      updateSet: vi.fn().mockResolvedValue({ id: "set-1" }),
      addSet: vi.fn().mockResolvedValue({ id: "set-2" }),
      deleteSet: vi.fn().mockResolvedValue(true),
      getUnitPreferences: vi.fn().mockResolvedValue(preferences),
    };
    const useCase = createMutateExerciseSetUseCase(storage);
    const owner = { kind, ownerId: "owner-1" };

    await useCase.updateSet(owner, "set-1", { reps: 5 }, "user-1");
    await useCase.addSet(owner, { exerciseName: "Run", category: "conditioning" }, "user-1");
    await useCase.deleteSet(owner, "set-1", "user-1");

    // Patches carry the athlete's units; new rows are stamped with them (L4).
    expect(storage.updateSet).toHaveBeenNthCalledWith(1, owner, "set-1", { reps: 5, unitPreferences: preferences }, "user-1");
    expect(storage.addSet).toHaveBeenNthCalledWith(
      1,
      owner,
      { exerciseName: "Run", category: "conditioning", weightUnit: "kg", distanceUnit: "m" },
      "user-1",
    );
    expect(storage.deleteSet).toHaveBeenNthCalledWith(1, owner, "set-1", "user-1");
  });
});

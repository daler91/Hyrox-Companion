import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/analyticsRouteCache", () => ({
  invalidateAnalyticsCachesForUser: vi.fn(),
}));

import { invalidateAnalyticsCachesForUser } from "../../../services/analyticsRouteCache";
import { createMutateExerciseSetUseCase } from "../mutateExerciseSet.usecase";

const WORKOUT = { kind: "workoutLog" as const, ownerId: "w1" };
const PLAN_DAY = { kind: "planDay" as const, ownerId: "pd1" };

function makeUseCase(overrides: Record<string, unknown> = {}) {
  const storage = {
    updateSet: vi.fn().mockResolvedValue({ id: "s1" }),
    addSet: vi.fn().mockResolvedValue({ id: "s2" }),
    deleteSet: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  return { storage, useCase: createMutateExerciseSetUseCase(storage) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mutateExerciseSet use case — derived-cache invalidation", () => {
  it("drops the athlete's cached analytics after every successful logged-set write", async () => {
    const { useCase } = makeUseCase();

    await useCase.updateSet(WORKOUT, "s1", { reps: 5 }, "user-1");
    await useCase.addSet(WORKOUT, { exerciseName: "squat" } as never, "user-1");
    await useCase.deleteSet(WORKOUT, "s1", "user-1");

    expect(invalidateAnalyticsCachesForUser).toHaveBeenCalledTimes(3);
    expect(invalidateAnalyticsCachesForUser).toHaveBeenCalledWith("user-1");
  });

  it("leaves the caches alone for planned-day sets, which feed no analytics", async () => {
    const { useCase } = makeUseCase();

    await useCase.updateSet(PLAN_DAY, "s1", { reps: 5 }, "user-1");
    await useCase.addSet(PLAN_DAY, { exerciseName: "squat" } as never, "user-1");
    await useCase.deleteSet(PLAN_DAY, "s1", "user-1");

    expect(invalidateAnalyticsCachesForUser).not.toHaveBeenCalled();
  });

  it("does not invalidate when the write found nothing to change", async () => {
    // A 404 path (wrong owner, missing set) must not evict a healthy cache.
    const { useCase } = makeUseCase({
      updateSet: vi.fn().mockResolvedValue(undefined),
      deleteSet: vi.fn().mockResolvedValue(false),
    });

    await useCase.updateSet(WORKOUT, "missing", { reps: 5 }, "user-1");
    await useCase.deleteSet(WORKOUT, "missing", "user-1");

    expect(invalidateAnalyticsCachesForUser).not.toHaveBeenCalled();
  });

  it("still returns the storage layer's result unchanged", async () => {
    const { useCase } = makeUseCase();

    await expect(useCase.updateSet(WORKOUT, "s1", {}, "user-1")).resolves.toEqual({
      id: "s1",
    });
    await expect(useCase.deleteSet(WORKOUT, "s1", "user-1")).resolves.toBe(true);
  });
});

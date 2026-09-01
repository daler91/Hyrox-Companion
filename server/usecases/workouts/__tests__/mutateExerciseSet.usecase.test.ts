import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/analyticsRouteCache", () => ({
  invalidateAnalyticsCachesForUser: vi.fn(),
}));

import { invalidateAnalyticsCachesForUser } from "../../../services/analyticsRouteCache";
import { createMutateExerciseSetUseCase } from "../mutateExerciseSet.usecase";

const WORKOUT = { kind: "workoutLog" as const, ownerId: "w1" };
const PLAN_DAY = { kind: "planDay" as const, ownerId: "pd1" };

const LB_ATHLETE = { weightUnit: "lbs", distanceUnit: "miles" };

function makeUseCase(overrides: Record<string, unknown> = {}) {
  const storage = {
    updateSet: vi.fn().mockResolvedValue({ id: "s1" }),
    addSet: vi.fn().mockResolvedValue({ id: "s2" }),
    deleteSet: vi.fn().mockResolvedValue(true),
    getUnitPreferences: vi.fn().mockResolvedValue(LB_ATHLETE),
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

describe("mutateExerciseSet use case — unit stamps (audit L4)", () => {
  it("stamps a new row with the athlete's current units (a lbs/miles athlete stores lbs and feet)", async () => {
    // Before this, "+Add row" wrote permanently unstamped rows — read as the
    // current preference forever, i.e. wrong by ~2.2x after any later switch.
    const { storage, useCase } = makeUseCase();

    await useCase.addSet(WORKOUT, { exerciseName: "squat", weight: 225 } as never, "user-1");

    expect(storage.getUnitPreferences).toHaveBeenCalledWith("user-1");
    expect(storage.addSet).toHaveBeenCalledWith(
      WORKOUT,
      { exerciseName: "squat", weight: 225, weightUnit: "lbs", distanceUnit: "ft" },
      "user-1",
    );
  });

  it("hands the athlete's preferences to storage with every patch so it can re-stamp the touched axes", async () => {
    const { storage, useCase } = makeUseCase();

    await useCase.updateSet(WORKOUT, "s1", { weight: 230 }, "user-1");

    expect(storage.updateSet).toHaveBeenCalledWith(
      WORKOUT,
      "s1",
      { weight: 230, unitPreferences: LB_ATHLETE },
      "user-1",
    );
  });

  it("stamps planned-day rows too — prescriptions are edited in the same units", async () => {
    const { storage, useCase } = makeUseCase({
      getUnitPreferences: vi.fn().mockResolvedValue({ weightUnit: "kg", distanceUnit: "km" }),
    });

    await useCase.addSet(PLAN_DAY, { exerciseName: "row", plannedDistance: 1000 } as never, "user-1");

    expect(storage.addSet).toHaveBeenCalledWith(
      PLAN_DAY,
      { exerciseName: "row", plannedDistance: 1000, weightUnit: "kg", distanceUnit: "m" },
      "user-1",
    );
  });
});

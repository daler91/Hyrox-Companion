import { type InvalidateQueryFilters, QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QUERY_KEYS } from "@/lib/api";
import { makeWrapper, setOnline } from "@/test/support/offlineMutationHarness";

import {
  useClearMealTargetOverride,
  useDeleteLog,
  useLogFood,
  useLogMealBatch,
  useRepeatDay,
  useSetMealTargetOverride,
  useUpdateCustomFood,
  useUpdateLog,
  useUpdateRecipe,
} from "../useNutrition";

const mocks = vi.hoisted(() => ({
  createLog: vi.fn(),
  updateLog: vi.fn(),
  deleteLog: vi.fn(),
  repeatDay: vi.fn(),
  createLogBatch: vi.fn(),
  updateCustomFood: vi.fn(),
  updateRecipe: vi.fn(),
  setMealTargetOverride: vi.fn(),
  clearMealTargetOverride: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, api: { ...actual.api, nutrition: { ...actual.api.nutrition, ...mocks } } };
});
vi.mock("@/lib/offlineQueue", async () =>
  (await import("@/test/support/offlineMutationHarness")).makeOfflineQueueMock(),
);
vi.mock("@/hooks/use-toast", async () =>
  (await import("@/test/support/offlineMutationHarness")).makeOfflineToastMock(),
);

let queryClient: QueryClient;
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queryClient")>()),
  queryClient: {
    invalidateQueries: (filters: InvalidateQueryFilters) => queryClient.invalidateQueries(filters),
  },
}));

const DATE = "2026-09-15";
const DAY = QUERY_KEYS.nutritionDay(DATE);
const OTHER_DAY = QUERY_KEYS.nutritionDay("2026-09-10");
const MICROS = QUERY_KEYS.nutritionMicros(DATE);
const RANGE = QUERY_KEYS.nutritionRange("2026-09-09", "2026-09-15");
const BLOCK = QUERY_KEYS.nutritionBlock("2026-08-17", "2026-09-15");
const SESSION = QUERY_KEYS.nutritionSessionFuelling("w1");
const CACHED = [DAY, OTHER_DAY, MICROS, RANGE, BLOCK, SESSION, QUERY_KEYS.nutritionTargets];

const wrapper = makeWrapper(() => queryClient);
const isInvalidated = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;

async function runWrite<T>(
  useWrite: () => { mutateAsync: (v: T) => Promise<unknown> },
  variables: T,
) {
  const { result } = renderHook(useWrite, { wrapper });
  await act(async () => {
    await result.current.mutateAsync(variables);
  });
}

// CL19 (CODEBASE_ANALYSIS_2026-10-03): a food-log write, online or replayed
// offline, refreshed the Timeline chips but neither the Analytics -> Fuelling
// block nor a workout's pre/post intake (SESSION), built from the same
// entries, so both showed the new log only after their staleTime.
describe("food-log writes refresh Analytics -> Fuelling and session intake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOnline(true);
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    for (const key of CACHED) queryClient.setQueryData(key, {});
  });

  const dayWrites: [string, () => Promise<void>][] = [
    [
      "useLogFood",
      () =>
        runWrite(() => useLogFood(DATE), {
          foodId: "f1",
          quantityG: 100,
          mealType: "lunch",
          loggedAt: "2026-09-15T12:00:00.000Z",
        }),
    ],
    [
      "useUpdateLog",
      () => runWrite(() => useUpdateLog(DATE), { id: "e1", data: { quantityG: 50 } }),
    ],
    ["useDeleteLog", () => runWrite(() => useDeleteLog(DATE), "e1")],
    [
      "useRepeatDay",
      () => runWrite(() => useRepeatDay(DATE), { sourceDate: "2026-09-14", targetDate: DATE }),
    ],
    [
      "useLogMealBatch",
      () =>
        runWrite(() => useLogMealBatch(DATE), {
          entryMethod: "nl",
          loggedAt: "2026-09-15T12:00:00.000Z",
          items: [{ foodId: "f1", quantityG: 100, mealType: "lunch" }],
        }),
    ],
  ];

  it.each(dayWrites)(
    "%s marks the day, its micros, the chips, the block and session intake stale",
    async (_name, write) => {
      mocks.createLog.mockResolvedValue({ id: "e1" });
      mocks.updateLog.mockResolvedValue({ id: "e1" });
      mocks.deleteLog.mockResolvedValue({ success: true });
      mocks.repeatDay.mockResolvedValue({ created: 1 });
      mocks.createLogBatch.mockResolvedValue({ created: 1 });

      await write();

      for (const key of [DAY, MICROS, RANGE, BLOCK, SESSION]) expect(isInvalidated(key)).toBe(true);
      expect(isInvalidated(OTHER_DAY)).toBe(false);
      expect(isInvalidated(QUERY_KEYS.nutritionTargets)).toBe(false);
    },
  );

  // A custom food or recipe is read live by its owner's logged entries, so an
  // edit changes the totals of every day it was logged on.
  const foodEdits: [string, () => Promise<void>][] = [
    [
      "useUpdateCustomFood",
      () => runWrite(useUpdateCustomFood, { id: "f1", data: { proteinPer100g: 30 } }),
    ],
    [
      "useUpdateRecipe",
      () =>
        runWrite(useUpdateRecipe, {
          id: "r1",
          data: { name: "Oats", servings: 1, ingredients: [{ foodId: "f1", quantityG: 80 }] },
        }),
    ],
  ];

  it.each(foodEdits)("%s marks every day and the multi-day reads stale", async (_name, write) => {
    mocks.updateCustomFood.mockResolvedValue({ id: "f1" });
    mocks.updateRecipe.mockResolvedValue({ id: "r1" });

    await write();

    for (const key of [DAY, OTHER_DAY, MICROS, RANGE, BLOCK, SESSION])
      expect(isInvalidated(key)).toBe(true);
    expect(isInvalidated(QUERY_KEYS.nutritionTargets)).toBe(false);
  });
});

// CL19 (CODEBASE_ANALYSIS_2026-10-03): a meal-override save applies from the
// athlete's local today on, and a reset deletes every version of the meal's
// override, so it changes past days too. Both refreshed only the open day, so
// other cached days (today among them, when another date was open) kept the
// old meal targets.
describe("meal-target overrides refresh every day summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOnline(true);
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    for (const key of CACHED) queryClient.setQueryData(key, {});
  });

  const overrideWrites: [string, () => Promise<void>][] = [
    [
      "useSetMealTargetOverride",
      () => runWrite(useSetMealTargetOverride, { mealType: "lunch", proteinG: 50 }),
    ],
    ["useClearMealTargetOverride", () => runWrite(useClearMealTargetOverride, "lunch")],
  ];

  it.each(overrideWrites)(
    "%s marks every day stale and leaves the totals reads alone",
    async (_name, write) => {
      mocks.setMealTargetOverride.mockResolvedValue({ id: "mt1" });
      mocks.clearMealTargetOverride.mockResolvedValue({ success: true });

      await write();

      for (const key of [DAY, OTHER_DAY]) expect(isInvalidated(key)).toBe(true);
      // Only the day summary carries meal targets.
      for (const key of [MICROS, RANGE, BLOCK, SESSION, QUERY_KEYS.nutritionTargets]) {
        expect(isInvalidated(key)).toBe(false);
      }
    },
  );
});

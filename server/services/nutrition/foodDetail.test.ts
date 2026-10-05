import type { FoodServing } from "@shared/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../storage", () => ({
  storage: {
    nutrition: {
      getVisibleFoodById: vi.fn(),
      getServings: vi.fn(),
      cacheServings: vi.fn(),
      upsertFoods: vi.fn(),
    },
  },
}));
vi.mock("./usdaClient", () => ({
  fetchUsdaFoodById: vi.fn(),
  fetchUsdaFoodPortions: vi.fn(),
}));

import { storage } from "../../storage";
import { getFoodWithServings } from "./foodDetail";
import { makeFood as food } from "./foodTestFixture";
import { fetchUsdaFoodById, fetchUsdaFoodPortions } from "./usdaClient";
import { PROVIDER_DEADLINE_MS } from "./utils";

function serving(over: Partial<FoodServing> = {}): FoodServing {
  return {
    id: "serving-1",
    foodId: "id1",
    label: "1 cup",
    grams: 150,
    createdByUserId: null,
    ...over,
  };
}

describe("getFoodWithServings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the food is not visible to the user", async () => {
    vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue(undefined);
    vi.mocked(storage.nutrition.getServings).mockResolvedValue([]);

    const result = await getFoodWithServings("user-1", "missing-food");

    expect(result).toBeNull();
    expect(fetchUsdaFoodPortions).not.toHaveBeenCalled();
  });

  it("returns the food's existing servings without hitting USDA", async () => {
    const f = food();
    const existing = [serving()];
    vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue(f);
    vi.mocked(storage.nutrition.getServings).mockResolvedValue(existing);

    const result = await getFoodWithServings("user-1", "id1");

    expect(result?.servings).toBe(existing);
    expect(fetchUsdaFoodPortions).not.toHaveBeenCalled();
  });

  it("backfills and caches USDA portions when a USDA food has no servings yet", async () => {
    const f = food({ source: "usda", sourceId: "fdc-1" });
    const cached = [serving({ label: "1 slice", grams: 30 })];
    vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue(f);
    vi.mocked(storage.nutrition.getServings).mockResolvedValue([]);
    vi.mocked(fetchUsdaFoodPortions).mockResolvedValue([{ label: "1 slice", grams: 30 }]);
    vi.mocked(storage.nutrition.cacheServings).mockResolvedValue(cached);

    const result = await getFoodWithServings("user-1", "id1");

    const call = vi.mocked(fetchUsdaFoodPortions).mock.calls.at(0);
    expect(call?.[0]).toBe("fdc-1");
    expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(storage.nutrition.cacheServings).toHaveBeenCalledWith("id1", [{ label: "1 slice", grams: 30 }]);
    expect(result?.servings).toBe(cached);
  });

  it("leaves servings empty when the USDA portions lookup finds none", async () => {
    const f = food({ source: "usda", sourceId: "fdc-1" });
    vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue(f);
    vi.mocked(storage.nutrition.getServings).mockResolvedValue([]);
    vi.mocked(fetchUsdaFoodPortions).mockResolvedValue([]);

    const result = await getFoodWithServings("user-1", "id1");

    expect(storage.nutrition.cacheServings).not.toHaveBeenCalled();
    expect(result?.servings).toEqual([]);
  });

  it("does not backfill servings for a non-USDA food even when it has none", async () => {
    const f = food({ source: "custom", sourceId: null });
    vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue(f);
    vi.mocked(storage.nutrition.getServings).mockResolvedValue([]);

    const result = await getFoodWithServings("user-1", "id1");

    expect(fetchUsdaFoodPortions).not.toHaveBeenCalled();
    expect(result?.servings).toEqual([]);
  });

  it("enriches a USDA food's micros from the detail endpoint when missing", async () => {
    const f = food({ source: "usda", sourceId: "fdc-1", micros: null });
    const enriched = { ...f, micros: { vitaminC: 10 } };
    vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue(f);
    vi.mocked(storage.nutrition.getServings).mockResolvedValue([serving()]);
    vi.mocked(fetchUsdaFoodById).mockResolvedValue({ ...f, micros: { vitaminC: 10 } } as never);
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([enriched]);

    const result = await getFoodWithServings("user-1", "id1");

    expect(storage.nutrition.upsertFoods).toHaveBeenCalledWith([
      expect.objectContaining({ micros: { vitaminC: 10 } }),
    ]);
    expect(result?.food).toBe(enriched);
  });

  it("returns the food unchanged when USDA micro enrichment throws", async () => {
    const f = food({ source: "usda", sourceId: "fdc-1", micros: null });
    vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue(f);
    vi.mocked(storage.nutrition.getServings).mockResolvedValue([serving()]);
    vi.mocked(fetchUsdaFoodById).mockRejectedValue(new Error("USDA is down"));

    const result = await getFoodWithServings("user-1", "id1");

    expect(storage.nutrition.upsertFoods).not.toHaveBeenCalled();
    expect(result?.food).toBe(f);
  });

  it("skips USDA micro enrichment when the food already has micros", async () => {
    const f = food({ source: "usda", sourceId: "fdc-1", micros: { vitaminC: 5 } });
    vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue(f);
    vi.mocked(storage.nutrition.getServings).mockResolvedValue([serving()]);

    const result = await getFoodWithServings("user-1", "id1");

    expect(fetchUsdaFoodById).not.toHaveBeenCalled();
    expect(result?.food).toBe(f);
  });
});

// D13 (CODEBASE_ANALYSIS_2026-10-03): the two USDA lookups ran back to back with
// only their per-attempt timeouts, so a hanging USDA kept an un-enriched food
// from opening at all.
describe("getFoodWithServings provider deadline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the food with what is cached once USDA hangs past the deadline", async () => {
    const f = food({ source: "usda", sourceId: "fdc-1", micros: null });
    vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue(f);
    vi.mocked(storage.nutrition.getServings).mockResolvedValue([]);
    vi.mocked(fetchUsdaFoodPortions).mockReturnValue(new Promise(() => { /* never settles */ }));
    vi.mocked(fetchUsdaFoodById).mockReturnValue(new Promise(() => { /* never settles */ }));

    const pending = getFoodWithServings("user-1", "id1");
    await vi.advanceTimersByTimeAsync(PROVIDER_DEADLINE_MS);
    const result = await pending;

    expect(result).toEqual({ food: f, servings: [] });
    expect(storage.nutrition.cacheServings).not.toHaveBeenCalled();
    expect(storage.nutrition.upsertFoods).not.toHaveBeenCalled();
  });

  it("shares one deadline across both lookups rather than one each", async () => {
    const f = food({ source: "usda", sourceId: "fdc-1", micros: null });
    vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue(f);
    vi.mocked(storage.nutrition.getServings).mockResolvedValue([]);
    // Portions answer after 8 s, inside the 9 s deadline; the micro lookup then hangs.
    vi.mocked(fetchUsdaFoodPortions).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve([]);
          }, 8_000);
        }),
    );
    vi.mocked(fetchUsdaFoodById).mockReturnValue(new Promise(() => { /* never settles */ }));

    const pending = getFoodWithServings("user-1", "id1");
    await vi.advanceTimersByTimeAsync(PROVIDER_DEADLINE_MS);
    const result = await pending;

    expect(result?.food).toBe(f);
    const [, opts] = vi.mocked(fetchUsdaFoodById).mock.calls[0] ?? [];
    expect(opts?.signal?.aborted).toBe(true);
  });
});

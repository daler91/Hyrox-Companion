import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("getFoodWithServings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when the food isn't visible to the user", async () => {
    vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue(undefined);

    const result = await getFoodWithServings("u1", "f1");

    expect(result).toBeNull();
    expect(storage.nutrition.getServings).not.toHaveBeenCalled();
    expect(fetchUsdaFoodById).not.toHaveBeenCalled();
  });

  it("returns cached servings unchanged and skips micro enrichment when micros already exist", async () => {
    const cachedFood = food({ micros: { vitaminC: 5 } });
    const servings = [{ id: "s1", foodId: "f1", label: "1 cup", grams: 240 }];
    vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue(cachedFood);
    vi.mocked(storage.nutrition.getServings).mockResolvedValue(servings as never);

    const result = await getFoodWithServings("u1", "f1");

    expect(result).toEqual({ food: cachedFood, servings });
    expect(fetchUsdaFoodPortions).not.toHaveBeenCalled();
    expect(fetchUsdaFoodById).not.toHaveBeenCalled();
  });

  it("backfills servings from USDA portions and enriches micros concurrently, combining both results", async () => {
    const bareFood = food({ micros: null });
    const enrichedFood = food({ micros: { vitaminC: 12 } });
    const cachedServings = [{ id: "s1", foodId: "f1", label: "1 medium", grams: 118 }];

    vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue(bareFood);
    vi.mocked(storage.nutrition.getServings).mockResolvedValue([]);
    vi.mocked(fetchUsdaFoodPortions).mockResolvedValue([{ label: "1 medium", grams: 118 }]);
    vi.mocked(storage.nutrition.cacheServings).mockResolvedValue(cachedServings as never);
    vi.mocked(fetchUsdaFoodById).mockResolvedValue({ ...enrichedFood } as never);
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([enrichedFood]);

    const result = await getFoodWithServings("u1", "f1");

    // Both independent branches ran (servings backfill from USDA portions, and
    // the separate USDA food-detail fetch for micros) and their results are
    // combined into one response even though neither awaited the other.
    expect(result).toEqual({ food: enrichedFood, servings: cachedServings });
    expect(fetchUsdaFoodPortions).toHaveBeenCalledWith(bareFood.sourceId);
    expect(fetchUsdaFoodById).toHaveBeenCalledWith(bareFood.sourceId);
    expect(storage.nutrition.cacheServings).toHaveBeenCalledWith("f1", [{ label: "1 medium", grams: 118 }]);
  });

  it("falls back to the original food when USDA enrichment throws, without losing servings", async () => {
    const bareFood = food({ micros: null });
    const servings = [{ id: "s1", foodId: "f1", label: "1 cup", grams: 240 }];
    vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue(bareFood);
    vi.mocked(storage.nutrition.getServings).mockResolvedValue(servings as never);
    vi.mocked(fetchUsdaFoodById).mockRejectedValue(new Error("network error"));

    const result = await getFoodWithServings("u1", "f1");

    expect(result).toEqual({ food: bareFood, servings });
  });
});

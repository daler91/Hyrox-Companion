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
  fetchUsdaFoodDetail: vi.fn(),
}));
vi.mock("../../sharedRuntimeState", () => ({
  getRuntimeCache: vi.fn(),
  setRuntimeCache: vi.fn(),
  runtimeCacheKey: (scope: string, value: string) => `${scope}:${value}`,
}));
vi.mock("../../logger", () => ({ logger: { warn: vi.fn() } }));

import { logger } from "../../logger";
import { getRuntimeCache, setRuntimeCache } from "../../sharedRuntimeState";
import { storage } from "../../storage";
import { getFoodWithServings } from "./foodDetail";
import { makeFood as food } from "./foodTestFixture";
import type { MappedFood } from "./types";
import { fetchUsdaFoodDetail } from "./usdaClient";
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

/** The detail endpoint's food, mapped; `micros` null unless given. */
function detailFood(micros: Record<string, number> | null = null): MappedFood {
  return {
    source: "usda",
    sourceId: "fdc-1",
    name: "Banana",
    brand: null,
    servingSizeG: null,
    caloriesPer100g: 89,
    proteinPer100g: 1.1,
    carbPer100g: 23,
    fatPer100g: 0.3,
    fiberPer100g: 2.6,
    micros,
  };
}

/** Back the shared marker with an in-memory store, so one open sees what another wrote. */
function keepMarkersInMemory(): void {
  const markers = new Map<string, unknown>();
  vi.mocked(setRuntimeCache).mockImplementation((key, value) => {
    markers.set(key, value);
    return Promise.resolve();
  });
  vi.mocked(getRuntimeCache).mockImplementation((key) => Promise.resolve(markers.get(key)));
}

function primeFood(over: Parameters<typeof food>[0], servings: FoodServing[]) {
  const visible = food(over);
  vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue(visible);
  vi.mocked(storage.nutrition.getServings).mockResolvedValue(servings);
  return visible;
}

describe("getFoodWithServings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRuntimeCache).mockResolvedValue(false);
  });

  it("returns null when the food is not visible to the user", async () => {
    vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue(undefined);
    vi.mocked(storage.nutrition.getServings).mockResolvedValue([]);

    const result = await getFoodWithServings("user-1", "missing-food");

    expect(result).toBeNull();
    expect(fetchUsdaFoodDetail).not.toHaveBeenCalled();
  });

  it("returns the food's existing servings without caching USDA portions", async () => {
    const existing = [serving()];
    primeFood({}, existing);
    vi.mocked(fetchUsdaFoodDetail).mockResolvedValue({
      food: detailFood(),
      portions: [{ label: "1 slice", grams: 30 }],
    });

    const result = await getFoodWithServings("user-1", "id1");

    expect(result?.servings).toBe(existing);
    expect(storage.nutrition.cacheServings).not.toHaveBeenCalled();
  });

  it("backfills and caches USDA portions when a USDA food has no servings yet", async () => {
    primeFood({ source: "usda", sourceId: "fdc-1", micros: { vitaminC: 5 } }, []);
    const cached = [serving({ label: "1 slice", grams: 30 })];
    vi.mocked(fetchUsdaFoodDetail).mockResolvedValue({
      food: detailFood(),
      portions: [{ label: "1 slice", grams: 30 }],
    });
    vi.mocked(storage.nutrition.cacheServings).mockResolvedValue(cached);

    const result = await getFoodWithServings("user-1", "id1");

    const call = vi.mocked(fetchUsdaFoodDetail).mock.calls.at(0);
    expect(call?.[0]).toBe("fdc-1");
    expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(storage.nutrition.cacheServings).toHaveBeenCalledWith("id1", [{ label: "1 slice", grams: 30 }]);
    expect(result?.servings).toBe(cached);
  });

  it("leaves servings empty when the USDA detail has no portions", async () => {
    primeFood({ source: "usda", sourceId: "fdc-1" }, []);
    vi.mocked(fetchUsdaFoodDetail).mockResolvedValue({ food: detailFood(), portions: [] });

    const result = await getFoodWithServings("user-1", "id1");

    expect(storage.nutrition.cacheServings).not.toHaveBeenCalled();
    expect(result?.servings).toEqual([]);
  });

  it("does not backfill servings for a non-USDA food even when it has none", async () => {
    primeFood({ source: "custom", sourceId: null }, []);

    const result = await getFoodWithServings("user-1", "id1");

    expect(fetchUsdaFoodDetail).not.toHaveBeenCalled();
    expect(getRuntimeCache).not.toHaveBeenCalled();
    expect(result?.servings).toEqual([]);
  });

  it("enriches a USDA food's micros from the detail endpoint when missing", async () => {
    const visible = primeFood({ source: "usda", sourceId: "fdc-1", micros: null }, [serving()]);
    const enriched = { ...visible, micros: { vitaminC: 10 } };
    vi.mocked(fetchUsdaFoodDetail).mockResolvedValue({
      food: detailFood({ vitaminC: 10 }),
      portions: [],
    });
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([enriched]);

    const result = await getFoodWithServings("user-1", "id1");

    expect(storage.nutrition.upsertFoods).toHaveBeenCalledWith([
      expect.objectContaining({ micros: { vitaminC: 10 } }),
    ]);
    expect(result?.food).toBe(enriched);
  });

  it("returns the food unchanged when the USDA detail read fails", async () => {
    const visible = primeFood({ source: "usda", sourceId: "fdc-1", micros: null }, [serving()]);
    vi.mocked(fetchUsdaFoodDetail).mockRejectedValue(new Error("USDA is down"));

    const result = await getFoodWithServings("user-1", "id1");

    expect(storage.nutrition.upsertFoods).not.toHaveBeenCalled();
    expect(result?.food).toBe(visible);
  });

  it("returns the food unchanged when saving its micros fails", async () => {
    const visible = primeFood({ source: "usda", sourceId: "fdc-1", micros: null }, [serving()]);
    vi.mocked(fetchUsdaFoodDetail).mockResolvedValue({
      food: detailFood({ vitaminC: 10 }),
      portions: [],
    });
    vi.mocked(storage.nutrition.upsertFoods).mockRejectedValue(new Error("db down"));

    const result = await getFoodWithServings("user-1", "id1");

    expect(result?.food).toBe(visible);
  });

  it("skips USDA entirely when the food already has micros and servings", async () => {
    const visible = primeFood({ source: "usda", sourceId: "fdc-1", micros: { vitaminC: 5 } }, [
      serving(),
    ]);

    const result = await getFoodWithServings("user-1", "id1");

    expect(fetchUsdaFoodDetail).not.toHaveBeenCalled();
    expect(getRuntimeCache).not.toHaveBeenCalled();
    expect(result?.food).toBe(visible);
  });
});

// PF11 (CODEBASE_ANALYSIS_2026-10-03): a Branded food (no portions, often no
// extra micros) read its USDA detail again on every open, twice per open.
describe("getFoodWithServings USDA detail reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRuntimeCache).mockResolvedValue(false);
  });

  it("reads the detail once for both the portions and the micros", async () => {
    primeFood({ source: "usda", sourceId: "fdc-1", micros: null }, []);
    vi.mocked(fetchUsdaFoodDetail).mockResolvedValue({
      food: detailFood({ vitaminC: 10 }),
      portions: [{ label: "1 slice", grams: 30 }],
    });
    vi.mocked(storage.nutrition.cacheServings).mockResolvedValue([serving()]);
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([food({ micros: { vitaminC: 10 } })]);

    await getFoodWithServings("user-1", "id1");

    expect(fetchUsdaFoodDetail).toHaveBeenCalledTimes(1);
    expect(storage.nutrition.cacheServings).toHaveBeenCalledTimes(1);
    expect(storage.nutrition.upsertFoods).toHaveBeenCalledTimes(1);
    // Everything the food lacked was filled, so the next open reads nothing.
    expect(setRuntimeCache).not.toHaveBeenCalled();
  });

  it("remembers a read that found no portions, and a later open skips USDA", async () => {
    const visible = primeFood({ source: "usda", sourceId: "fdc-1", micros: { vitaminC: 5 } }, []);
    vi.mocked(fetchUsdaFoodDetail).mockResolvedValue({ food: detailFood(), portions: [] });

    await getFoodWithServings("user-1", "id1");

    expect(getRuntimeCache).toHaveBeenCalledWith("usda-detail-read:fdc-1");
    expect(setRuntimeCache).toHaveBeenCalledWith(
      "usda-detail-read:fdc-1",
      { noPortions: true, noMicros: true },
      expect.any(Number),
    );
    const [, , ttlMs] = vi.mocked(setRuntimeCache).mock.calls[0] ?? [];
    expect(ttlMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);

    vi.mocked(fetchUsdaFoodDetail).mockClear();
    vi.mocked(getRuntimeCache).mockResolvedValue({ noPortions: true, noMicros: true });
    const again = await getFoodWithServings("user-1", "id1");

    expect(fetchUsdaFoodDetail).not.toHaveBeenCalled();
    expect(again).toEqual({ food: visible, servings: [] });
  });

  it("remembers a read whose detail carried no micros for a food that lacks them", async () => {
    primeFood({ source: "usda", sourceId: "fdc-1", micros: null }, [serving()]);
    vi.mocked(fetchUsdaFoodDetail).mockResolvedValue({ food: detailFood(), portions: [] });

    await getFoodWithServings("user-1", "id1");

    expect(storage.nutrition.upsertFoods).not.toHaveBeenCalled();
    expect(setRuntimeCache).toHaveBeenCalledWith(
      "usda-detail-read:fdc-1",
      { noPortions: true, noMicros: true },
      expect.any(Number),
    );
  });

  // The marker is shared by every user, so it records what USDA lacks, not
  // what one user's open still lacked.
  it("lets a user with no servings read the portions a first user's open left uncached", async () => {
    keepMarkersInMemory();
    // A personal serving means user A's open only looks for micros.
    primeFood({ source: "usda", sourceId: "fdc-1", micros: null }, [
      serving({ createdByUserId: "user-a" }),
    ]);
    vi.mocked(fetchUsdaFoodDetail).mockResolvedValue({
      food: detailFood(),
      portions: [{ label: "1 cup", grams: 240 }],
    });

    await getFoodWithServings("user-a", "id1");

    expect(storage.nutrition.cacheServings).not.toHaveBeenCalled();
    expect(setRuntimeCache).toHaveBeenCalledWith(
      "usda-detail-read:fdc-1",
      { noPortions: false, noMicros: true },
      expect.any(Number),
    );

    primeFood({ source: "usda", sourceId: "fdc-1", micros: null }, []);
    const cached = [serving({ label: "1 cup", grams: 240 })];
    vi.mocked(storage.nutrition.cacheServings).mockResolvedValue(cached);

    const forB = await getFoodWithServings("user-b", "id1");

    expect(fetchUsdaFoodDetail).toHaveBeenCalledTimes(2);
    expect(storage.nutrition.cacheServings).toHaveBeenCalledWith("id1", [
      { label: "1 cup", grams: 240 },
    ]);
    expect(forB?.servings).toBe(cached);

    // With the portions cached, only the micros are missing, and USDA has none.
    primeFood({ source: "usda", sourceId: "fdc-1", micros: null }, cached);
    await getFoodWithServings("user-c", "id1");

    expect(fetchUsdaFoodDetail).toHaveBeenCalledTimes(2);
  });

  it("reads the micros again on the next open when saving them failed", async () => {
    keepMarkersInMemory();
    primeFood({ source: "usda", sourceId: "fdc-1", micros: null }, []);
    vi.mocked(fetchUsdaFoodDetail).mockResolvedValue({
      food: detailFood({ vitaminC: 10 }),
      portions: [],
    });
    vi.mocked(storage.nutrition.upsertFoods).mockRejectedValueOnce(new Error("db down"));

    await getFoodWithServings("user-1", "id1");

    expect(setRuntimeCache).toHaveBeenCalledWith(
      "usda-detail-read:fdc-1",
      { noPortions: true, noMicros: false },
      expect.any(Number),
    );

    const enriched = food({ sourceId: "fdc-1", micros: { vitaminC: 10 } });
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([enriched]);

    const again = await getFoodWithServings("user-1", "id1");

    expect(fetchUsdaFoodDetail).toHaveBeenCalledTimes(2);
    expect(again?.food).toBe(enriched);

    // Now only the portions are missing, and USDA has none.
    primeFood({ sourceId: "fdc-1", micros: { vitaminC: 10 } }, []);
    await getFoodWithServings("user-1", "id1");

    expect(fetchUsdaFoodDetail).toHaveBeenCalledTimes(2);
  });

  it("does not remember a read USDA did not answer", async () => {
    primeFood({ source: "usda", sourceId: "fdc-1" }, []);
    vi.mocked(fetchUsdaFoodDetail).mockResolvedValue(null);

    await getFoodWithServings("user-1", "id1");

    expect(setRuntimeCache).not.toHaveBeenCalled();
  });

  it("reads USDA when the shared marker cannot be read", async () => {
    primeFood({ source: "usda", sourceId: "fdc-1" }, []);
    vi.mocked(getRuntimeCache).mockRejectedValue(new Error("db down"));
    vi.mocked(fetchUsdaFoodDetail).mockResolvedValue({ food: detailFood(), portions: [] });

    const result = await getFoodWithServings("user-1", "id1");

    expect(fetchUsdaFoodDetail).toHaveBeenCalledTimes(1);
    expect(result?.servings).toEqual([]);
  });

  it("still opens the food when the marker cannot be written", async () => {
    const visible = primeFood({ source: "usda", sourceId: "fdc-1", micros: { vitaminC: 5 } }, []);
    vi.mocked(fetchUsdaFoodDetail).mockResolvedValue({ food: detailFood(), portions: [] });
    vi.mocked(setRuntimeCache).mockRejectedValue(new Error("db down"));

    const result = await getFoodWithServings("user-1", "id1");

    expect(result).toEqual({ food: visible, servings: [] });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

// D13 (CODEBASE_ANALYSIS_2026-10-03): the USDA lookups ran with only their
// per-attempt timeouts, so a hanging USDA kept an un-enriched food from
// opening at all.
describe("getFoodWithServings provider deadline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRuntimeCache).mockResolvedValue(false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the food with what is cached once USDA hangs past the deadline", async () => {
    const cachedFood = primeFood({ source: "usda", sourceId: "fdc-1", micros: null }, []);
    vi.mocked(fetchUsdaFoodDetail).mockReturnValue(new Promise(() => { /* never settles */ }));

    const pending = getFoodWithServings("user-1", "id1");
    await vi.advanceTimersByTimeAsync(PROVIDER_DEADLINE_MS);
    const result = await pending;

    expect(result).toEqual({ food: cachedFood, servings: [] });
    expect(storage.nutrition.cacheServings).not.toHaveBeenCalled();
    expect(storage.nutrition.upsertFoods).not.toHaveBeenCalled();
    expect(setRuntimeCache).not.toHaveBeenCalled();
  });

  it("aborts the USDA read at the deadline", async () => {
    primeFood({ source: "usda", sourceId: "fdc-1", micros: null }, []);
    vi.mocked(fetchUsdaFoodDetail).mockReturnValue(new Promise(() => { /* never settles */ }));

    const pending = getFoodWithServings("user-1", "id1");
    await vi.advanceTimersByTimeAsync(PROVIDER_DEADLINE_MS - 1);
    const [, opts] = vi.mocked(fetchUsdaFoodDetail).mock.calls[0] ?? [];
    expect(opts?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect(opts?.signal?.aborted).toBe(true);
  });
});

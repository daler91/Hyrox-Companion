import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Keep RetryableHttpError / isTransientNetworkError real; strip backoff delays.
vi.mock("../../utils/httpRetry", async () => {
  const actual = await vi.importActual<typeof import("../../utils/httpRetry")>("../../utils/httpRetry");
  return {
    ...actual,
    retryWithJitter: async (fn: () => Promise<unknown>, opts?: { retries?: number }) => {
      const retries = opts?.retries ?? 0;
      let lastErr: unknown;
      for (let i = 0; i <= retries; i++) {
        try {
          return await fn();
        } catch (err) {
          lastErr = err;
          const retryable =
            err instanceof actual.RetryableHttpError || actual.isTransientNetworkError(err);
          if (!retryable || i >= retries) throw err;
        }
      }
      throw lastErr;
    },
  };
});

vi.mock("../../env", () => ({ env: { SPOONACULAR_API_KEY: "test-key" } }));
vi.mock("../../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { env } from "../../env";
import {
  getSpoonacularFoodById,
  mapSpoonacularProduct,
  resolveSpoonacularBarcode,
  searchSpoonacularFoods,
} from "./spoonacularClient";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } });
const errResponse = (status: number) => ({ ok: false, status, json: async () => ({}), headers: { get: () => null } });

// 31 g serving → per-100g = amount * 100 / 31.
const PRODUCT = {
  id: 123,
  title: "Special K Cereal",
  brand: "Kellogg's",
  nutrition: {
    nutrients: [
      { name: "Calories", amount: 120, unit: "kcal" },
      { name: "Fat", amount: 1, unit: "g" },
      { name: "Saturated Fat", amount: 0.5, unit: "g" },
      { name: "Carbohydrates", amount: 25, unit: "g" },
      { name: "Protein", amount: 2, unit: "g" },
      { name: "Fiber", amount: 3, unit: "g" },
      { name: "Sodium", amount: 200, unit: "mg" },
      { name: "Vitamin A", amount: 500, unit: "IU" }, // IU → must be skipped
      { name: "Vitamin D", amount: 2, unit: "µg" },
    ],
    weightPerServing: { amount: 31, unit: "g" },
  },
  servings: { number: 1, size: 31, unit: "g" },
};

describe("mapSpoonacularProduct", () => {
  it("converts per-serving nutrients to per-100g via weightPerServing", () => {
    const m = mapSpoonacularProduct(PRODUCT);
    expect(m).toMatchObject({ source: "spoonacular", sourceId: "123", name: "Special K Cereal", brand: "Kellogg's" });
    expect(m?.servingSizeG).toBe(31);
    expect(m?.caloriesPer100g).toBeCloseTo((120 * 100) / 31, 4);
    expect(m?.proteinPer100g).toBeCloseTo((2 * 100) / 31, 4);
    expect(m?.carbPer100g).toBeCloseTo((25 * 100) / 31, 4);
    // Exact-name match: "Fat" (1g), not "Saturated Fat" (0.5g).
    expect(m?.fatPer100g).toBeCloseTo((1 * 100) / 31, 4);
    expect(m?.fiberPer100g).toBeCloseTo((3 * 100) / 31, 4);
  });

  it("maps unit-matching micros and skips IU-encoded ones", () => {
    const m = mapSpoonacularProduct(PRODUCT);
    expect(m?.micros?.sodium).toBeCloseTo((200 * 100) / 31, 4);
    expect(m?.micros?.vitaminD).toBeCloseTo((2 * 100) / 31, 4); // µg matches mcg
    expect(m?.micros?.vitaminA).toBeUndefined(); // IU ≠ mcg → skipped
  });

  it("converts an oz serving weight to grams", () => {
    const m = mapSpoonacularProduct({
      id: 1,
      title: "Jerky",
      nutrition: { nutrients: [{ name: "Protein", amount: 9, unit: "g" }], weightPerServing: { amount: 1, unit: "oz" } },
    });
    expect(m?.servingSizeG).toBeCloseTo(28.349523125, 6);
    expect(m?.proteinPer100g).toBeCloseTo((9 * 100) / 28.349523125, 4);
  });

  it("falls back to servings.size when weightPerServing is absent", () => {
    const m = mapSpoonacularProduct({
      id: 2,
      title: "Bar",
      nutrition: { nutrients: [{ name: "Calories", amount: 200, unit: "kcal" }] },
      servings: { size: 50, unit: "g" },
    });
    expect(m?.servingSizeG).toBe(50);
    expect(m?.caloriesPer100g).toBe(400);
  });

  it("returns null when the serving is volume-only (no gram basis)", () => {
    expect(
      mapSpoonacularProduct({
        id: 3,
        title: "Juice",
        nutrition: { nutrients: [{ name: "Calories", amount: 100, unit: "kcal" }], weightPerServing: { amount: 240, unit: "ml" } },
        servings: { size: 240, unit: "ml" },
      }),
    ).toBeNull();
  });

  it("infers grams from Spoonacular's servings.raw text", () => {
    const m = mapSpoonacularProduct({
      id: 10,
      title: "Clif Bar",
      nutrition: { nutrients: [{ name: "Calories", amount: 250, unit: "kcal" }] },
      servings: { number: 1, raw: "1 bar (68 g)" },
    });
    expect(m?.servingSizeG).toBe(68);
    expect(m?.caloriesPer100g).toBeCloseTo((250 * 100) / 68, 4);
  });

  it("infers a serving weight from an oz net-weight in the title (per-1 serving)", () => {
    const m = mapSpoonacularProduct({
      id: 11,
      title: "CLIF Bar Energy Bars, 18 Ct, 2.4 oz",
      nutrition: { nutrients: [{ name: "Calories", amount: 250, unit: "kcal" }] },
      servings: { number: 1 },
    });
    expect(m?.servingSizeG).toBeCloseTo(2.4 * 28.349523125, 4);
  });

  it("rejects an implausible container weight in the title (16 oz jar)", () => {
    expect(
      mapSpoonacularProduct({
        id: 12,
        title: "Peanut Butter 16 oz Jar",
        nutrition: { nutrients: [{ name: "Calories", amount: 190, unit: "kcal" }] },
        servings: { number: 1 },
      }),
    ).toBeNull(); // ~454 g > 250 g serving cap → no weight → dropped
  });

  it("does not treat a 'g' macro figure in the title as a serving weight", () => {
    expect(
      mapSpoonacularProduct({
        id: 13,
        title: "Protein Bar 9g Protein",
        nutrition: { nutrients: [{ name: "Calories", amount: 250, unit: "kcal" }] },
        servings: { number: 1 },
      }),
    ).toBeNull(); // only "oz" is read from titles; "9g" is ignored → dropped
  });

  it("does not infer a title weight when nutrition is per multiple servings", () => {
    expect(
      mapSpoonacularProduct({
        id: 14,
        title: "Energy Bars 2.4 oz",
        nutrition: { nutrients: [{ name: "Calories", amount: 250, unit: "kcal" }] },
        servings: { number: 12 },
      }),
    ).toBeNull(); // servings.number > 1 → title inference skipped → dropped
  });

  it("reads nutrients labeled with `title` (food-product shape), not only `name`", () => {
    const m = mapSpoonacularProduct({
      id: 30,
      title: "Some Product",
      nutrition: {
        nutrients: [
          { title: "Calories", amount: 200, unit: "kcal" },
          { title: "Protein", amount: 10, unit: "g" },
          { title: "Sodium", amount: 100, unit: "mg" },
        ],
        weightPerServing: { amount: 50, unit: "g" },
      },
    });
    expect(m?.caloriesPer100g).toBe(400);
    expect(m?.proteinPer100g).toBe(20);
    expect(m?.micros?.sodium).toBe(200);
  });

  it("drops a product whose nutrients are all zero (Spoonacular placeholder record)", () => {
    expect(
      mapSpoonacularProduct({
        id: 20,
        title: "Clif Bar Case 2.4 oz",
        nutrition: {
          nutrients: [
            { name: "Calories", amount: 0, unit: "kcal" },
            { name: "Protein", amount: 0, unit: "g" },
            { name: "Carbohydrates", amount: 0, unit: "g" },
            { name: "Fat", amount: 0, unit: "g" },
            { name: "Sodium", amount: 0, unit: "mg" },
          ],
          weightPerServing: { amount: 68, unit: "g" }, // valid weight, but no usable macros
        },
        servings: { number: 1 },
      }),
    ).toBeNull();
  });

  it("returns null without an id or title", () => {
    expect(mapSpoonacularProduct({ title: "X", nutrition: { weightPerServing: { amount: 10, unit: "g" } } })).toBeNull();
    expect(mapSpoonacularProduct({ id: 5, nutrition: { weightPerServing: { amount: 10, unit: "g" } } })).toBeNull();
  });
});

describe("searchSpoonacularFoods", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    (env as { SPOONACULAR_API_KEY?: string }).SPOONACULAR_API_KEY = "test-key";
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function routeByPath(bodies: { search: unknown; products: Record<string, unknown> }) {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/food/products/search")) return Promise.resolve(ok(bodies.search));
      const match = /\/food\/products\/(\d+)/.exec(url);
      const id = match?.[1] ?? "";
      return Promise.resolve(ok(bodies.products[id]));
    });
  }

  it("does nothing and reports not-reached when no API key is set", async () => {
    (env as { SPOONACULAR_API_KEY?: string }).SPOONACULAR_API_KEY = undefined;
    const result = await searchSpoonacularFoods("cereal");
    expect(result).toEqual({ foods: [], reached: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the API key and detail-fetches each search hit", async () => {
    routeByPath({ search: { products: [{ id: 123 }] }, products: { "123": PRODUCT } });
    const result = await searchSpoonacularFoods("cereal");

    expect(result.reached).toBe(true);
    expect(result.foods).toHaveLength(1);
    expect(result.foods[0].sourceId).toBe("123");
    expect(fetchMock.mock.calls[0][0]).toContain("apiKey=test-key");
  });

  it("is reached with no foods when the search returns no products", async () => {
    fetchMock.mockResolvedValue(ok({ products: [] }));
    const result = await searchSpoonacularFoods("zzzzz");
    expect(result).toEqual({ foods: [], reached: true });
    expect(fetchMock).toHaveBeenCalledTimes(1); // search only, no detail calls
  });

  it("degrades (not reached) when the daily quota is exhausted (HTTP 402)", async () => {
    fetchMock.mockResolvedValue(errResponse(402));
    const result = await searchSpoonacularFoods("cereal");
    expect(result).toEqual({ foods: [], reached: false });
    expect(fetchMock).toHaveBeenCalledTimes(1); // 402 is non-retryable
  });

  it("caps detail fetches to the per-search maximum", async () => {
    const ids = [1, 2, 3, 4, 5, 6, 7];
    const products = Object.fromEntries(
      ids.map((id) => [String(id), { id, title: `P${id}`, nutrition: { nutrients: [{ name: "Calories", amount: 100, unit: "kcal" }], weightPerServing: { amount: 100, unit: "g" } } }]),
    );
    routeByPath({ search: { products: ids.map((id) => ({ id })) }, products });

    const result = await searchSpoonacularFoods("snack");
    expect(result.foods).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(6); // 1 search + 5 details (capped)
  });
});

describe("resolveSpoonacularBarcode / getSpoonacularFoodById", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    (env as { SPOONACULAR_API_KEY?: string }).SPOONACULAR_API_KEY = "test-key";
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("resolves a UPC to a mapped food", async () => {
    fetchMock.mockResolvedValue(ok(PRODUCT));
    const m = await resolveSpoonacularBarcode("038000391910");
    expect(m?.sourceId).toBe("123");
    expect(fetchMock.mock.calls[0][0]).toContain("/food/products/upc/038000391910");
  });

  it("returns null for an unknown UPC (HTTP 404)", async () => {
    fetchMock.mockResolvedValue(errResponse(404));
    expect(await resolveSpoonacularBarcode("0000000000000")).toBeNull();
  });

  it("returns null (no fetch) when no API key is set", async () => {
    (env as { SPOONACULAR_API_KEY?: string }).SPOONACULAR_API_KEY = undefined;
    expect(await resolveSpoonacularBarcode("038000391910")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches a product by id", async () => {
    fetchMock.mockResolvedValue(ok(PRODUCT));
    const m = await getSpoonacularFoodById("123");
    expect(m?.name).toBe("Special K Cereal");
  });
});

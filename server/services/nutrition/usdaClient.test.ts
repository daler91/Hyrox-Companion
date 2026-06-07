import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../env", () => ({ env: { USDA_API_KEY: "test-key" } }));

// Keep RetryableHttpError / parseRetryAfter / isTransientNetworkError real, but
// strip the backoff delays from retryWithJitter so retry tests run instantly.
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

import { env } from "../../env";
import { mapUsdaSearchFood, searchUsdaFoods } from "./usdaClient";

const okResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  headers: { get: () => null },
});
const errResponse = (status: number) => ({
  ok: false,
  status,
  json: async () => ({}),
  headers: { get: () => null },
});

describe("mapUsdaSearchFood", () => {
  it("maps a Foundation food's per-100g nutrients", () => {
    const mapped = mapUsdaSearchFood({
      fdcId: 100,
      description: "Banana, raw",
      foodNutrients: [
        { nutrientNumber: "1008", unitName: "KCAL", value: 89 },
        { nutrientNumber: "1003", value: 1.1 },
        { nutrientNumber: "1005", value: 22.8 },
        { nutrientNumber: "1004", value: 0.3 },
        { nutrientNumber: "1079", value: 2.6 },
      ],
      servingSize: 118,
      servingSizeUnit: "g",
    });
    expect(mapped).toMatchObject({
      source: "usda",
      sourceId: "100",
      name: "Banana, raw",
      brand: null,
      caloriesPer100g: 89,
      proteinPer100g: 1.1,
      carbPer100g: 22.8,
      fatPer100g: 0.3,
      fiberPer100g: 2.6,
      servingSizeG: 118,
    });
  });

  it("derives per-100g from Branded labelNutrients when foodNutrients is empty", () => {
    const mapped = mapUsdaSearchFood({
      fdcId: 200,
      description: "Protein Bar",
      brandOwner: "Acme",
      foodNutrients: [],
      servingSize: 30,
      servingSizeUnit: "g",
      labelNutrients: { calories: { value: 150 }, protein: { value: 30 } },
    });
    expect(mapped?.brand).toBe("Acme");
    expect(mapped?.caloriesPer100g).toBeCloseTo(500); // 150 / 30 * 100
    expect(mapped?.proteinPer100g).toBeCloseTo(100);
  });

  it("reads kcal (1008) but never the kJ duplicate (1062)", () => {
    expect(
      mapUsdaSearchFood({
        fdcId: 1,
        description: "x",
        foodNutrients: [{ nutrientNumber: "1062", unitName: "kJ", value: 372 }],
      })?.caloriesPer100g,
    ).toBeNull();
    expect(
      mapUsdaSearchFood({
        fdcId: 1,
        description: "x",
        foodNutrients: [{ nutrientNumber: "1008", unitName: "kcal", value: 89 }],
      })?.caloriesPer100g,
    ).toBe(89);
  });

  it("returns null per-nutrient when missing and null for an unusable record", () => {
    expect(mapUsdaSearchFood({ fdcId: 1, description: "x", foodNutrients: [] })?.proteinPer100g).toBeNull();
    expect(mapUsdaSearchFood({ description: "no id" })).toBeNull();
  });

  it("converts serving units to grams and skips volume units", () => {
    expect(
      mapUsdaSearchFood({ fdcId: 1, description: "x", servingSize: 1, servingSizeUnit: "oz", foodNutrients: [] })
        ?.servingSizeG,
    ).toBeCloseTo(28.349523125);
    expect(
      mapUsdaSearchFood({ fdcId: 1, description: "x", servingSize: 100, servingSizeUnit: "ml", foodNutrients: [] })
        ?.servingSizeG,
    ).toBeNull();
  });
});

describe("searchUsdaFoods", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    (env as { USDA_API_KEY?: string }).USDA_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns [] without calling the API when no key is configured", async () => {
    (env as { USDA_API_KEY?: string }).USDA_API_KEY = undefined;
    const result = await searchUsdaFoods("banana");
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a successful response", async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        foods: [
          { fdcId: 1, description: "Banana", foodNutrients: [{ nutrientNumber: "1008", unitName: "kcal", value: 89 }] },
        ],
      }),
    );
    const result = await searchUsdaFoods("banana");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sourceId: "1", name: "Banana", caloriesPer100g: 89 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries a 429 then succeeds", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(429)).mockResolvedValueOnce(okResponse({ foods: [] }));
    const result = await searchUsdaFoods("x");
    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws (without retrying) on a non-retryable 4xx", async () => {
    fetchMock.mockResolvedValue(errResponse(400));
    await expect(searchUsdaFoods("x")).rejects.toThrow(/HTTP 400/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries transient network errors then gives up", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    await expect(searchUsdaFoods("x")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});

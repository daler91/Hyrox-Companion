import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// httpRetry mocked to strip backoff delays (manual mock in __mocks__/httpRetry).
vi.mock("../../utils/httpRetry");

import { errResponse, ok } from "./httpClientTestSupport";
import { isRelevantOffMatch, mapOffProduct, resolveBarcode, searchOffFoods } from "./offClient";
import type { MappedFood } from "./types";

const PRODUCT = {
  product_name: "Nutella",
  brands: "Ferrero,Nutella",
  serving_quantity: 15,
  serving_size: "15 g",
  nutriments: {
    "energy-kcal_100g": 539,
    proteins_100g: 6.3,
    carbohydrates_100g: 57.5,
    fat_100g: 30.9,
    fiber_100g: 0,
  },
};

describe("mapOffProduct", () => {
  it("maps per-100g nutrition, first brand token, and serving grams", () => {
    expect(mapOffProduct("3017620422003", PRODUCT)).toMatchObject({
      source: "off",
      sourceId: "3017620422003",
      name: "Nutella",
      brand: "Ferrero",
      servingSizeG: 15,
      caloriesPer100g: 539,
      proteinPer100g: 6.3,
      carbPer100g: 57.5,
      fatPer100g: 30.9,
      fiberPer100g: 0,
    });
  });

  it("returns null without a product name", () => {
    expect(mapOffProduct("1", { nutriments: {} })).toBeNull();
  });

  it("coerces a string serving_quantity and falls back to fibre_100g", () => {
    const m = mapOffProduct("1", {
      product_name: "X",
      serving_quantity: "30",
      nutriments: { fibre_100g: 2.1 },
    });
    expect(m?.servingSizeG).toBe(30);
    expect(m?.fiberPer100g).toBe(2.1);
  });

  it("rejects a low-completeness product that also lacks calories", () => {
    expect(
      mapOffProduct("1", {
        product_name: "X",
        completeness: 0.2,
        nutriments: { proteins_100g: 5 },
      }),
    ).toBeNull();
  });

  it("keeps a low-completeness product when it has calories", () => {
    const m = mapOffProduct("1", {
      product_name: "X",
      completeness: 0.2,
      nutriments: { "energy-kcal_100g": 100 },
    });
    expect(m?.caloriesPer100g).toBe(100);
  });

  it("keeps a product with unknown completeness (doesn't hold it against them)", () => {
    const m = mapOffProduct("1", { product_name: "X", nutriments: { proteins_100g: 5 } });
    expect(m?.proteinPer100g).toBe(5);
  });
});

describe("resolveBarcode", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns the mapped food when found (status 1)", async () => {
    fetchMock.mockResolvedValue(ok({ status: 1, product: PRODUCT }));
    const m = await resolveBarcode("3017620422003");
    expect(m?.name).toBe("Nutella");
  });

  it("returns null when not found (HTTP 200 + status 0)", async () => {
    fetchMock.mockResolvedValue(ok({ status: 0 }));
    expect(await resolveBarcode("0000000000000")).toBeNull();
  });

  it("returns null on HTTP 404", async () => {
    fetchMock.mockResolvedValue(errResponse(404));
    expect(await resolveBarcode("0000000000000")).toBeNull();
  });

  it("retries a 429 then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(errResponse(429))
      .mockResolvedValueOnce(ok({ status: 1, product: PRODUCT }));
    const m = await resolveBarcode("3017620422003");
    expect(m?.name).toBe("Nutella");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends a descriptive User-Agent (OFF policy)", async () => {
    fetchMock.mockResolvedValue(ok({ status: 1, product: PRODUCT }));
    await resolveBarcode("3017620422003");
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers["User-Agent"]).toMatch(/HyroxCompanion/);
  });
});

describe("isRelevantOffMatch", () => {
  const food = (name: string, brand: string | null = null): MappedFood => ({
    source: "off",
    sourceId: "x",
    name,
    brand,
    servingSizeG: null,
    caloriesPer100g: null,
    proteinPer100g: null,
    carbPer100g: null,
    fatPer100g: null,
    fiberPer100g: null,
    micros: null,
  });

  it("matches when every query token prefixes a word in the name", () => {
    expect(isRelevantOffMatch("greek yogurt", food("Greek Yogurt 0% Fat"))).toBe(true);
  });

  it("matches a word prefix (choc → Chocolate)", () => {
    expect(isRelevantOffMatch("choc", food("Chocolate Bar"))).toBe(true);
  });

  it("matches against the brand, not just the name", () => {
    expect(isRelevantOffMatch("dole", food("Banana", "Dole"))).toBe(true);
  });

  it("rejects when any query token is absent from name and brand", () => {
    expect(isRelevantOffMatch("banana split", food("Banana"))).toBe(false);
  });

  it("requires a word boundary (mid-word substring does not match)", () => {
    expect(isRelevantOffMatch("ogurt", food("Yogurt"))).toBe(false);
  });

  it("is false for an empty / punctuation-only query", () => {
    expect(isRelevantOffMatch("   ", food("Banana"))).toBe(false);
  });
});

describe("searchOffFoods", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const banana = {
    code: "111",
    product_name: "Banana",
    brands: "Dole",
    nutriments: {
      "energy-kcal_100g": 89,
      proteins_100g: 1.1,
      carbohydrates_100g: 23,
      fat_100g: 0.3,
    },
  };
  const cookie = {
    code: "222",
    product_name: "Chocolate Cookies",
    brands: "Acme",
    nutriments: { "energy-kcal_100g": 500 },
  };

  it("returns only OFF hits whose name/brand matches the query", async () => {
    fetchMock.mockResolvedValue(ok({ products: [banana, cookie] }));
    const { foods, reached } = await searchOffFoods("banana");
    expect(reached).toBe(true);
    expect(foods.map((f) => f.sourceId)).toEqual(["111"]);
    expect(foods[0]).toMatchObject({
      source: "off",
      name: "Banana",
      brand: "Dole",
      caloriesPer100g: 89,
    });
  });

  it("skips products without a barcode code", async () => {
    fetchMock.mockResolvedValue(ok({ products: [{ ...banana, code: undefined }] }));
    const { foods } = await searchOffFoods("banana");
    expect(foods).toEqual([]);
  });

  it("degrades to reached:false on a non-retryable error", async () => {
    fetchMock.mockResolvedValue(errResponse(400));
    expect(await searchOffFoods("banana")).toEqual({ foods: [], reached: false });
  });

  it("retries a 429 then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(errResponse(429))
      .mockResolvedValueOnce(ok({ products: [banana] }));
    const { foods, reached } = await searchOffFoods("banana");
    expect(reached).toBe(true);
    expect(foods).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends the search term and a descriptive User-Agent (OFF policy)", async () => {
    fetchMock.mockResolvedValue(ok({ products: [] }));
    await searchOffFoods("greek yogurt");
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toContain("search_terms=greek+yogurt");
    expect(init.headers["User-Agent"]).toMatch(/HyroxCompanion/);
  });
});

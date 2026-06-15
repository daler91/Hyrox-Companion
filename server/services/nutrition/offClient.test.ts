import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// httpRetry mocked to strip backoff delays (manual mock in __mocks__/httpRetry).
vi.mock("../../utils/httpRetry");

import { errResponse, ok } from "./httpClientTestSupport";
import { mapOffProduct, resolveBarcode } from "./offClient";

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
      mapOffProduct("1", { product_name: "X", completeness: 0.2, nutriments: { proteins_100g: 5 } }),
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
    fetchMock.mockResolvedValueOnce(errResponse(429)).mockResolvedValueOnce(ok({ status: 1, product: PRODUCT }));
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

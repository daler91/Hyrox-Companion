import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../env", () => ({
  env: {
    FATSECRET_CLIENT_ID: "cid",
    FATSECRET_CLIENT_SECRET: "csec",
    FATSECRET_SCOPE: "basic premier barcode",
    FATSECRET_REGION: undefined,
    FATSECRET_LANGUAGE: undefined,
  },
}));

vi.mock("../../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

// Shared token cache mocked to a permanent miss so each call mints fresh; the
// in-process cache (reset per test) provides the warm-path coverage.
vi.mock("../../sharedRuntimeState", () => ({
  getRuntimeCache: vi.fn(async () => undefined),
  setRuntimeCache: vi.fn(async () => {}),
  deleteRuntimeCache: vi.fn(async () => {}),
}));

// Keep the real error classes; strip backoff delays.
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
import {
  __resetFatSecretTokenCacheForTests,
  getFatSecretFoodById,
  mapFatSecretFood,
  mapFatSecretV1Food,
  resolveFatSecretBarcode,
  searchFatSecretFoods,
} from "./fatsecretClient";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } });
const err = (status: number) => ({ ok: false, status, json: async () => ({}), headers: { get: () => null } });
// Compare the host exactly (not a substring) so this can't be fooled by a URL
// like "oauth.fatsecret.com.evil.test" — and to satisfy CodeQL.
const isTokenUrl = (url: unknown) => {
  try {
    return new URL(String(url)).hostname === "oauth.fatsecret.com";
  } catch {
    return false;
  }
};

const SEARCH_BODY = {
  foods_search: {
    results: {
      food: [
        {
          food_id: "33691",
          food_name: "Clif Bar",
          brand_name: "Clif",
          servings: {
            serving: {
              metric_serving_amount: "68.000",
              metric_serving_unit: "g",
              calories: "250",
              protein: "9",
              carbohydrate: "44",
              fat: "5",
              fiber: "5",
              sodium: "150",
            },
          },
        },
      ],
    },
  },
};

const FOOD_GET_BODY = {
  food: {
    food_id: "555",
    food_name: "Banana",
    brand_name: null,
    servings: {
      serving: {
        metric_serving_amount: "100.000",
        metric_serving_unit: "g",
        calories: "89",
        protein: "1.1",
        carbohydrate: "23",
        fat: "0.3",
        fiber: "2.6",
      },
    },
  },
};

describe("mapFatSecretFood", () => {
  it("normalizes a gram serving to per-100g and reads mg micros as-is", () => {
    const m = mapFatSecretFood({
      food_id: "1",
      food_name: "Yogurt",
      brand_name: "Brand",
      servings: {
        serving: {
          metric_serving_amount: "50",
          metric_serving_unit: "g",
          calories: "100",
          protein: "5",
          carbohydrate: "10",
          fat: "2",
          fiber: "1",
          sodium: "60",
        },
      },
    });
    expect(m).toMatchObject({
      source: "fatsecret",
      sourceId: "1",
      name: "Yogurt",
      brand: "Brand",
      servingSizeG: 50,
      caloriesPer100g: 200,
      proteinPer100g: 10,
      carbPer100g: 20,
      fatPer100g: 4,
      fiberPer100g: 2,
    });
    // 60 mg / 50 g * 100 = 120 mg per 100g — read as mg, NOT multiplied by 1000.
    expect(m?.micros).toEqual({ sodium: 120 });
  });

  it("converts an oz serving to grams", () => {
    const m = mapFatSecretFood({
      food_id: "2",
      food_name: "Nuts",
      servings: { serving: { metric_serving_amount: "1", metric_serving_unit: "oz", calories: "10" } },
    });
    expect(m?.servingSizeG).toBeCloseTo(28.349523125);
    expect(m?.caloriesPer100g).toBeCloseTo((10 * 100) / 28.349523125, 4);
  });

  it("drops a food whose only serving is volume (ml)", () => {
    const m = mapFatSecretFood({
      food_id: "3",
      food_name: "Juice",
      servings: { serving: { metric_serving_amount: "100", metric_serving_unit: "ml", calories: "40" } },
    });
    expect(m).toBeNull();
  });

  it("prefers the gram serving when servings are mixed", () => {
    const m = mapFatSecretFood({
      food_id: "4",
      food_name: "Soup",
      servings: {
        serving: [
          { metric_serving_amount: "240", metric_serving_unit: "ml", calories: "200" },
          { metric_serving_amount: "100", metric_serving_unit: "g", calories: "52" },
        ],
      },
    });
    expect(m?.servingSizeG).toBe(100);
    expect(m?.caloriesPer100g).toBe(52);
  });

  it("returns null without a food_id or name", () => {
    expect(mapFatSecretFood({ food_name: "x", servings: { serving: { metric_serving_amount: "100", metric_serving_unit: "g", calories: "1" } } })).toBeNull();
    expect(mapFatSecretFood({ food_id: "5", servings: { serving: { metric_serving_amount: "100", metric_serving_unit: "g", calories: "1" } } })).toBeNull();
  });
});

describe("mapFatSecretV1Food (Basic tier description parsing)", () => {
  it("parses a per-serving description into per-100g", () => {
    const m = mapFatSecretV1Food({
      food_id: "33691",
      food_name: "Clif Bar",
      brand_name: "Clif",
      food_description: "Per 1 bar (68g) - Calories: 250kcal | Fat: 5.00g | Carbs: 44.00g | Protein: 9.00g",
    });
    expect(m).toMatchObject({ source: "fatsecret", sourceId: "33691", name: "Clif Bar", brand: "Clif", servingSizeG: 68 });
    expect(m?.caloriesPer100g).toBeCloseTo((250 * 100) / 68);
    expect(m?.proteinPer100g).toBeCloseTo((9 * 100) / 68);
    expect(m?.fiberPer100g).toBeNull();
  });

  it("parses a Per 100g description directly", () => {
    const m = mapFatSecretV1Food({
      food_id: "1",
      food_name: "Banana",
      food_description: "Per 100g - Calories: 89kcal | Fat: 0.33g | Carbs: 22.84g | Protein: 1.09g",
    });
    expect(m?.caloriesPer100g).toBeCloseTo(89);
    expect(m?.carbPer100g).toBeCloseTo(22.84);
  });

  it("drops a volume-only (ml) basis it can't convert to grams", () => {
    expect(
      mapFatSecretV1Food({
        food_id: "2",
        food_name: "Juice",
        food_description: "Per 1 cup (240ml) - Calories: 110kcal | Fat: 0g | Carbs: 26g | Protein: 1g",
      }),
    ).toBeNull();
  });

  it("returns null without a description", () => {
    expect(mapFatSecretV1Food({ food_id: "3", food_name: "X" })).toBeNull();
  });
});

describe("FatSecret API operations", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    __resetFatSecretTokenCacheForTests();
    (env as Record<string, unknown>).FATSECRET_CLIENT_ID = "cid";
    (env as Record<string, unknown>).FATSECRET_CLIENT_SECRET = "csec";
    (env as Record<string, unknown>).FATSECRET_SCOPE = "basic premier barcode";
  });
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(api: () => unknown, token: () => unknown = () => ok({ access_token: "T", expires_in: 86400 })) {
    fetchMock.mockImplementation(async (url: unknown) => (isTokenUrl(url) ? token() : api()));
  }

  describe("searchFatSecretFoods", () => {
    it("returns no foods and never calls the network without credentials", async () => {
      (env as Record<string, unknown>).FATSECRET_CLIENT_ID = undefined;
      const result = await searchFatSecretFoods("clif");
      expect(result).toEqual({ foods: [], reached: false });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("mints a token then maps results (token + api fetch)", async () => {
      stubFetch(() => ok(SEARCH_BODY));
      const result = await searchFatSecretFoods("clif");
      expect(result.reached).toBe(true);
      expect(result.foods).toHaveLength(1);
      expect(result.foods[0]).toMatchObject({ source: "fatsecret", sourceId: "33691", caloriesPer100g: (250 * 100) / 68 });
      expect(fetchMock).toHaveBeenCalledTimes(2); // token + api
    });

    it("reuses the cached token on the next call (api fetch only)", async () => {
      stubFetch(() => ok(SEARCH_BODY));
      await searchFatSecretFoods("clif");
      fetchMock.mockClear();
      await searchFatSecretFoods("clif");
      expect(fetchMock).toHaveBeenCalledTimes(1); // token reused
    });

    it("normalizes a single-object result into an array", async () => {
      stubFetch(() => ok({ foods_search: { results: { food: SEARCH_BODY.foods_search.results.food[0] } } }));
      const result = await searchFatSecretFoods("clif");
      expect(result.foods).toHaveLength(1);
    });

    it("treats a not-found error envelope as reached-but-empty", async () => {
      stubFetch(() => ok({ error: { code: 211, message: "no results" } }));
      const result = await searchFatSecretFoods("zzz");
      expect(result).toEqual({ foods: [], reached: true });
    });

    it("treats an auth/scope error envelope as not reached (degrade)", async () => {
      stubFetch(() => ok({ error: { code: 21, message: "invalid scope" } }));
      const result = await searchFatSecretFoods("clif");
      expect(result).toEqual({ foods: [], reached: false });
    });

    it("degrades (reached:false) when the token can't be minted — e.g. a non-whitelisted IP", async () => {
      stubFetch(() => ok(SEARCH_BODY), () => err(401));
      const result = await searchFatSecretFoods("clif");
      expect(result).toEqual({ foods: [], reached: false });
    });

    it("refreshes the token exactly once on a 401 and retries, without looping", async () => {
      let tokenCalls = 0;
      let apiCalls = 0;
      fetchMock.mockImplementation(async (url: unknown) => {
        if (isTokenUrl(url)) {
          tokenCalls += 1;
          return ok({ access_token: `T${tokenCalls}`, expires_in: 86400 });
        }
        apiCalls += 1;
        return apiCalls === 1 ? err(401) : ok(SEARCH_BODY);
      });
      const result = await searchFatSecretFoods("clif");
      expect(result.foods).toHaveLength(1);
      expect(tokenCalls).toBe(2); // initial + one forced refresh
      expect(fetchMock).toHaveBeenCalledTimes(4); // token, api(401), token, api(200)
    });

    it("gives up (no infinite loop) when the 401 persists after refresh", async () => {
      stubFetch(() => err(401));
      const result = await searchFatSecretFoods("clif");
      expect(result).toEqual({ foods: [], reached: false });
      expect(fetchMock).toHaveBeenCalledTimes(4); // token, api(401), token, api(401)
    });
  });

  describe("resolveFatSecretBarcode", () => {
    it("pads to GTIN-13, resolves the id, then fetches and maps the food", async () => {
      let apiCall = 0;
      fetchMock.mockImplementation(async (url: unknown) => {
        if (isTokenUrl(url)) return ok({ access_token: "T", expires_in: 86400 });
        apiCall += 1;
        return apiCall === 1 ? ok({ food_id: { value: "555" } }) : ok(FOOD_GET_BODY);
      });
      const food = await resolveFatSecretBarcode("0049000028");
      expect(food).toMatchObject({ source: "fatsecret", sourceId: "555", name: "Banana", caloriesPer100g: 89 });
      const idCallBody = String((fetchMock.mock.calls.find((c) => !isTokenUrl(c[0]))?.[1] as { body: string }).body);
      expect(idCallBody).toContain("barcode=0000049000028"); // left-padded to 13 digits
    });

    it("returns null for an unknown barcode (food_id 0)", async () => {
      let apiCall = 0;
      fetchMock.mockImplementation(async (url: unknown) => {
        if (isTokenUrl(url)) return ok({ access_token: "T", expires_in: 86400 });
        apiCall += 1;
        return apiCall === 1 ? ok({ food_id: { value: "0" } }) : ok(FOOD_GET_BODY);
      });
      expect(await resolveFatSecretBarcode("0000000000000")).toBeNull();
    });

    it("returns null on a not-found error envelope", async () => {
      stubFetch(() => ok({ error: { code: 211 } }));
      expect(await resolveFatSecretBarcode("0000000000000")).toBeNull();
    });
  });

  describe("getFatSecretFoodById", () => {
    it("maps the food detail", async () => {
      stubFetch(() => ok(FOOD_GET_BODY));
      const food = await getFatSecretFoodById("555");
      expect(food).toMatchObject({ sourceId: "555", name: "Banana" });
    });

    it("returns null on an error envelope", async () => {
      stubFetch(() => ok({ error: { code: 106 } }));
      expect(await getFatSecretFoodById("999")).toBeNull();
    });
  });
});

describe("FatSecret on the free Basic (v1) tier", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    __resetFatSecretTokenCacheForTests();
    (env as Record<string, unknown>).FATSECRET_CLIENT_ID = "cid";
    (env as Record<string, unknown>).FATSECRET_CLIENT_SECRET = "csec";
    (env as Record<string, unknown>).FATSECRET_SCOPE = "basic";
  });
  afterEach(() => vi.unstubAllGlobals());

  const V1_BODY = {
    foods: {
      food: [
        {
          food_id: "33691",
          food_name: "Clif Bar",
          food_type: "Brand",
          brand_name: "Clif",
          food_description: "Per 1 bar (68g) - Calories: 250kcal | Fat: 5.00g | Carbs: 44.00g | Protein: 9.00g",
        },
      ],
    },
  };

  it("calls the v1 foods.search method and parses the description", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      isTokenUrl(url) ? ok({ access_token: "T", expires_in: 86400 }) : ok(V1_BODY),
    );
    const result = await searchFatSecretFoods("clif");
    expect(result.reached).toBe(true);
    expect(result.foods).toHaveLength(1);
    expect(result.foods[0]).toMatchObject({ source: "fatsecret", sourceId: "33691", caloriesPer100g: (250 * 100) / 68 });

    const apiCall = fetchMock.mock.calls.find((c) => !isTokenUrl(c[0]));
    const body = String((apiCall?.[1] as { body: string }).body);
    expect(body).toContain("method=foods.search");
    expect(body).not.toContain("foods.search.v3"); // v1, not the Premier method
  });

  it("skips FatSecret barcode entirely without the barcode scope", async () => {
    fetchMock.mockImplementation(async () => ok({}));
    expect(await resolveFatSecretBarcode("0049000028")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled(); // no wasted call — straight to OFF
  });

  it("skips food.get (detail/refresh) without the premier scope", async () => {
    fetchMock.mockImplementation(async () => ok({}));
    expect(await getFatSecretFoodById("33691")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

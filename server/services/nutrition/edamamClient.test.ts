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

vi.mock("../../env", () => ({ env: { EDAMAM_APP_ID: "test-id", EDAMAM_APP_KEY: "test-key" } }));
vi.mock("../../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { env } from "../../env";
import { mapEdamamFood, resolveEdamamBarcode, searchEdamamFoods } from "./edamamClient";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } });
const errResponse = (status: number) => ({ ok: false, status, json: async () => ({}), headers: { get: () => null } });

const HINT = {
  food: {
    foodId: "food_abc",
    label: "Clif Bar",
    brand: "Clif",
    nutrients: { ENERC_KCAL: 367, PROCNT: 13.3, FAT: 10, CHOCDF: 66.7, FIBTG: 6.7 },
  },
  measures: [
    { label: "Serving", weight: 68 },
    { label: "Gram", weight: 1 },
  ],
};

describe("mapEdamamFood", () => {
  it("maps Edamam's per-100g nutrients directly (no scaling)", () => {
    expect(mapEdamamFood(HINT)).toEqual({
      source: "edamam",
      sourceId: "food_abc",
      name: "Clif Bar",
      brand: "Clif",
      servingSizeG: 68,
      caloriesPer100g: 367,
      proteinPer100g: 13.3,
      carbPer100g: 66.7,
      fatPer100g: 10,
      fiberPer100g: 6.7,
      micros: null,
    });
  });

  it("falls back to knownAs when label is absent, and has no serving without one", () => {
    const m = mapEdamamFood({ food: { foodId: "f2", knownAs: "Rice", nutrients: { ENERC_KCAL: 130 } } });
    expect(m?.name).toBe("Rice");
    expect(m?.servingSizeG).toBeNull();
    expect(m?.caloriesPer100g).toBe(130);
  });

  it("drops a food with no positive macros", () => {
    expect(
      mapEdamamFood({ food: { foodId: "f3", label: "Empty", nutrients: { ENERC_KCAL: 0, PROCNT: 0, FAT: 0, CHOCDF: 0 } } }),
    ).toBeNull();
  });

  it("returns null without a foodId or name", () => {
    expect(mapEdamamFood({ food: { label: "X", nutrients: { ENERC_KCAL: 100 } } })).toBeNull();
    expect(mapEdamamFood({ food: { foodId: "f4", nutrients: { ENERC_KCAL: 100 } } })).toBeNull();
  });
});

describe("searchEdamamFoods", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    (env as { EDAMAM_APP_ID?: string; EDAMAM_APP_KEY?: string }).EDAMAM_APP_ID = "test-id";
    (env as { EDAMAM_APP_ID?: string; EDAMAM_APP_KEY?: string }).EDAMAM_APP_KEY = "test-key";
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("does nothing and reports not-reached when credentials are missing", async () => {
    (env as { EDAMAM_APP_ID?: string }).EDAMAM_APP_ID = undefined;
    const result = await searchEdamamFoods("clif bar");
    expect(result).toEqual({ foods: [], reached: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps hints and sends the credentials", async () => {
    fetchMock.mockResolvedValue(ok({ hints: [HINT] }));
    const result = await searchEdamamFoods("clif bar");

    expect(result.reached).toBe(true);
    expect(result.foods).toHaveLength(1);
    expect(result.foods[0].sourceId).toBe("food_abc");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("app_id=test-id");
    expect(url).toContain("app_key=test-key");
    expect(url).toContain("ingr=clif");
  });

  it("is reached with no foods when there are no hints", async () => {
    fetchMock.mockResolvedValue(ok({ hints: [] }));
    expect(await searchEdamamFoods("zzzzz")).toEqual({ foods: [], reached: true });
  });

  it("degrades (not reached) on a bad key (HTTP 401)", async () => {
    fetchMock.mockResolvedValue(errResponse(401));
    expect(await searchEdamamFoods("clif bar")).toEqual({ foods: [], reached: false });
    expect(fetchMock).toHaveBeenCalledTimes(1); // non-retryable
  });
});

describe("resolveEdamamBarcode", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    (env as { EDAMAM_APP_ID?: string; EDAMAM_APP_KEY?: string }).EDAMAM_APP_ID = "test-id";
    (env as { EDAMAM_APP_ID?: string; EDAMAM_APP_KEY?: string }).EDAMAM_APP_KEY = "test-key";
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("resolves a UPC to the first hint", async () => {
    fetchMock.mockResolvedValue(ok({ hints: [HINT] }));
    const m = await resolveEdamamBarcode("038000391910");
    expect(m?.sourceId).toBe("food_abc");
    expect(fetchMock.mock.calls[0][0]).toContain("upc=038000391910");
  });

  it("returns null when the UPC has no hints", async () => {
    fetchMock.mockResolvedValue(ok({ hints: [] }));
    expect(await resolveEdamamBarcode("0000000000000")).toBeNull();
  });

  it("returns null (no fetch) when credentials are missing", async () => {
    (env as { EDAMAM_APP_KEY?: string }).EDAMAM_APP_KEY = undefined;
    expect(await resolveEdamamBarcode("038000391910")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

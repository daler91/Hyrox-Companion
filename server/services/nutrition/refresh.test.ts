import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the side-effectful imports so loading refresh.ts doesn't pull in the DB.
vi.mock("../../storage", () => ({ storage: { nutrition: { upsertFoods: vi.fn() } } }));
vi.mock("../../logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("./edamamClient", () => ({ getEdamamFoodById: vi.fn() }));
vi.mock("./offClient", () => ({ resolveBarcode: vi.fn() }));
vi.mock("./usdaClient", () => ({ fetchUsdaFoodById: vi.fn() }));

import { storage } from "../../storage";
import { getEdamamFoodById } from "./edamamClient";
import { makeFood as food } from "./foodTestFixture";
import { resolveBarcode } from "./offClient";
import {
  __resetFoodRefreshStateForTests,
  isStaleFood,
  REFRESH_RETRY_BACKOFF_MS,
  refreshStaleFoodsInBackground,
  STALE_AFTER_MS,
} from "./refresh";
import type { MappedFood } from "./types";
import { fetchUsdaFoodById } from "./usdaClient";

describe("isStaleFood", () => {
  it("is stale when never stamped (legacy cached row)", () => {
    expect(isStaleFood(food({ lastFetchedAt: null }))).toBe(true);
  });

  it("is stale when older than the threshold", () => {
    expect(isStaleFood(food({ lastFetchedAt: new Date(Date.now() - STALE_AFTER_MS - 1000) }))).toBe(true);
  });

  it("is fresh when stamped recently", () => {
    expect(isStaleFood(food({ lastFetchedAt: new Date() }))).toBe(false);
  });

  it("never refreshes a custom food (no upstream)", () => {
    expect(isStaleFood(food({ source: "custom", sourceId: null, lastFetchedAt: null }))).toBe(false);
  });

  it("never refreshes a row without a source id", () => {
    expect(isStaleFood(food({ sourceId: null, lastFetchedAt: null }))).toBe(false);
  });
});

describe("refreshStaleFoodsInBackground (PF13)", () => {
  const offFood = food({ id: "off-1", source: "off", sourceId: "5000159484695" });
  const mapped = { source: "off", sourceId: "5000159484695", name: "Banana" } as MappedFood;

  /** Let the fire-and-forget refreshes run to completion. */
  function settle(): Promise<void> {
    return new Promise((resolve) => {
      setImmediate(resolve);
    });
  }

  beforeEach(() => {
    __resetFoodRefreshStateForTests();
    vi.mocked(resolveBarcode).mockReset();
    vi.mocked(fetchUsdaFoodById).mockReset();
    vi.mocked(storage.nutrition.upsertFoods).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshes a stale food from its upstream and re-caches it", async () => {
    vi.mocked(resolveBarcode).mockResolvedValue(mapped);

    refreshStaleFoodsInBackground([offFood]);
    await settle();

    expect(resolveBarcode).toHaveBeenCalledWith("5000159484695");
    expect(storage.nutrition.upsertFoods).toHaveBeenCalledWith([mapped]);
  });

  it("does not start a second refresh of a food whose first one is still running", async () => {
    const upstream: { answer?: (value: MappedFood | null) => void } = {};
    vi.mocked(resolveBarcode).mockImplementation(
      () =>
        new Promise((resolve) => {
          upstream.answer = resolve;
        }),
    );

    refreshStaleFoodsInBackground([offFood]);
    refreshStaleFoodsInBackground([offFood, offFood]);
    expect(resolveBarcode).toHaveBeenCalledTimes(1);

    upstream.answer?.(mapped);
    await settle();
    expect(storage.nutrition.upsertFoods).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["comes back empty", () => vi.mocked(resolveBarcode).mockResolvedValue(null)],
    ["fails", () => vi.mocked(resolveBarcode).mockRejectedValue(new Error("OFF 429"))],
  ])("leaves a food alone for the backoff window after its refetch %s", async (_label, arrange) => {
    arrange();
    const start = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);

    refreshStaleFoodsInBackground([offFood]);
    await settle();
    refreshStaleFoodsInBackground([offFood]);
    await settle();
    expect(resolveBarcode).toHaveBeenCalledTimes(1);

    clock.mockReturnValue(start + REFRESH_RETRY_BACKOFF_MS + 1);
    refreshStaleFoodsInBackground([offFood]);
    await settle();
    expect(resolveBarcode).toHaveBeenCalledTimes(2);
    expect(storage.nutrition.upsertFoods).not.toHaveBeenCalled();
  });

  it("gives a backed-off food's slot to the next stale food in the response", async () => {
    vi.mocked(resolveBarcode).mockResolvedValue(null);
    refreshStaleFoodsInBackground([offFood]);
    await settle();
    vi.mocked(fetchUsdaFoodById).mockResolvedValue(null);

    const usdaFoods = ["11", "12", "13"].map((sourceId) => food({ id: `usda-${sourceId}`, sourceId }));
    refreshStaleFoodsInBackground([offFood, ...usdaFoods]);
    await settle();

    expect(resolveBarcode).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchUsdaFoodById).mock.calls).toEqual([["11"], ["12"], ["13"]]);
  });
});

describe("refreshStaleFoodsInBackground: sources and backoff bounds", () => {
  function settle(): Promise<void> {
    return new Promise((resolve) => {
      setImmediate(resolve);
    });
  }

  beforeEach(() => {
    __resetFoodRefreshStateForTests();
    vi.mocked(resolveBarcode).mockReset();
    vi.mocked(getEdamamFoodById).mockReset();
    vi.mocked(storage.nutrition.upsertFoods).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("re-searches an Edamam food by its source id and name, and re-caches the match", async () => {
    const mapped = { source: "edamam", sourceId: "food_abc", name: "Oats" } as MappedFood;
    vi.mocked(getEdamamFoodById).mockResolvedValue(mapped);

    refreshStaleFoodsInBackground([food({ id: "e-1", source: "edamam", sourceId: "food_abc", name: "Oats" })]);
    await settle();

    expect(getEdamamFoodById).toHaveBeenCalledWith("food_abc", "Oats");
    expect(storage.nutrition.upsertFoods).toHaveBeenCalledWith([mapped]);
  });

  it("keeps serving a row whose source has no client, backing it off rather than retrying every response", async () => {
    const legacy = food({ id: "fs-1", source: "fatsecret", sourceId: "99" });

    refreshStaleFoodsInBackground([legacy]);
    await settle();
    refreshStaleFoodsInBackground([legacy]);
    await settle();

    expect(storage.nutrition.upsertFoods).not.toHaveBeenCalled();
    expect(resolveBarcode).not.toHaveBeenCalled();
    expect(getEdamamFoodById).not.toHaveBeenCalled();
  });

  it("bounds the backoff table by forgetting the oldest entry first", async () => {
    vi.mocked(resolveBarcode).mockResolvedValue(null);
    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start);

    // MAX_BACKOFF_ENTRIES is 1000: the 1001st failure evicts the first.
    for (let i = 0; i <= 1000; i += 1) {
      refreshStaleFoodsInBackground([food({ id: `off-${i}`, source: "off", sourceId: `${i}` })]);
      await settle();
    }
    expect(resolveBarcode).toHaveBeenCalledTimes(1001);

    // The newest is still backing off; the evicted oldest is tried again.
    refreshStaleFoodsInBackground([food({ id: "off-1000", source: "off", sourceId: "1000" })]);
    await settle();
    expect(resolveBarcode).toHaveBeenCalledTimes(1001);

    refreshStaleFoodsInBackground([food({ id: "off-0", source: "off", sourceId: "0" })]);
    await settle();
    expect(resolveBarcode).toHaveBeenCalledTimes(1002);
  });
});

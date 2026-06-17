import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../storage", () => ({
  storage: { nutrition: { searchLocalFoods: vi.fn(), upsertFoods: vi.fn() } },
}));
vi.mock("./usdaClient", () => ({ searchUsdaFoods: vi.fn() }));
vi.mock("./edamamClient", () => ({ searchEdamamFoods: vi.fn() }));
vi.mock("./offClient", () => ({ searchOffFoods: vi.fn() }));
vi.mock("./refresh", () => ({ refreshStaleFoodsInBackground: vi.fn() }));
vi.mock("../../env", () => ({ env: { USDA_API_KEY: "test-key" } }));
vi.mock("../../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { env } from "../../env";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { searchEdamamFoods } from "./edamamClient";
import { searchFoods } from "./foodSearch";
import { makeFood as food } from "./foodTestFixture";
import { searchOffFoods } from "./offClient";
import { searchUsdaFoods } from "./usdaClient";

const mappedUsda = {
  source: "usda" as const,
  sourceId: "1",
  name: "Banana",
  brand: null,
  servingSizeG: null,
  caloriesPer100g: 89,
  proteinPer100g: 1.1,
  carbPer100g: 23,
  fatPer100g: 0.3,
  fiberPer100g: 2.6,
  micros: null,
};
const mappedEdamam = { ...mappedUsda, source: "edamam" as const, sourceId: "ed1" };
const mappedOff = { ...mappedUsda, source: "off" as const, sourceId: "off1" };

describe("searchFoods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (env as { USDA_API_KEY?: string }).USDA_API_KEY = "test-key";
    // Default: Edamam unconfigured/unreached, USDA + OFF + local empty.
    vi.mocked(searchEdamamFoods).mockResolvedValue({ foods: [], reached: false });
    vi.mocked(searchUsdaFoods).mockResolvedValue([]);
    vi.mocked(searchOffFoods).mockResolvedValue({ foods: [], reached: false });
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([]);
  });

  it("ranks Edamam ahead of USDA ahead of local, not degraded", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([
      food({ id: "local1", source: "custom", sourceId: null }),
    ]);
    vi.mocked(searchEdamamFoods).mockResolvedValue({ foods: [mappedEdamam], reached: true });
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(storage.nutrition.upsertFoods)
      .mockResolvedValueOnce([food({ id: "ed1", source: "edamam", sourceId: "ed1" })])
      .mockResolvedValueOnce([food({ id: "usda1", source: "usda", sourceId: "1" })]);

    const result = await searchFoods("banana", "u1");

    expect(result.apiDegraded).toBe(false);
    expect(result.results.map((f) => f.id)).toEqual(["ed1", "usda1", "local1"]);
  });

  it("is not degraded when USDA returns no matches but the key is set", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);

    const result = await searchFoods("banana", "u1");

    expect(result.apiDegraded).toBe(false);
    expect(storage.nutrition.upsertFoods).not.toHaveBeenCalled();
    expect(result.results.map((f) => f.id)).toEqual(["local1"]);
  });

  it("is not degraded when Edamam reached the API even with no matches (USDA off)", async () => {
    (env as { USDA_API_KEY?: string }).USDA_API_KEY = undefined;
    vi.mocked(searchEdamamFoods).mockResolvedValue({ foods: [], reached: true });
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);

    const result = await searchFoods("banana", "u1");
    expect(result.apiDegraded).toBe(false);
  });

  it("flags degraded when no provider is live (cache-only)", async () => {
    (env as { USDA_API_KEY?: string }).USDA_API_KEY = undefined;
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);

    const result = await searchFoods("banana", "u1");
    expect(result.apiDegraded).toBe(true);
    expect(result.results).toHaveLength(1);
  });

  it("returns results and is not degraded when Edamam throws but USDA succeeds", async () => {
    vi.mocked(searchEdamamFoods).mockRejectedValue(new Error("edamam down"));
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([food({ id: "usda1" })]);

    const result = await searchFoods("banana", "u1");
    expect(result.apiDegraded).toBe(false);
    expect(result.results.map((f) => f.id)).toEqual(["usda1"]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("flags degraded and returns cache when USDA throws and Edamam is unconfigured", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);
    vi.mocked(searchUsdaFoods).mockRejectedValue(new Error("USDA down"));

    const result = await searchFoods("banana", "u1");
    expect(result.apiDegraded).toBe(true);
    expect(result.results.map((f) => f.id)).toEqual(["local1"]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("dedupes a food present in both the live result and local cache", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([
      food({ id: "localdup", source: "usda", sourceId: "1" }),
    ]);
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([
      food({ id: "usda1", source: "usda", sourceId: "1" }),
    ]);

    const result = await searchFoods("banana", "u1");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe("usda1");
  });

  it("degrades to cache (no throw) when caching the live results fails", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(storage.nutrition.upsertFoods).mockRejectedValue(new Error("constraint violation"));

    const result = await searchFoods("banana", "u1");
    // USDA was reached, so not degraded — but its uncacheable results are dropped,
    // leaving only the local cache. The request must not throw.
    expect(result.apiDegraded).toBe(false);
    expect(result.results.map((f) => f.id)).toEqual(["local1"]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("suppresses a cross-source brand+name near-duplicate (Edamam wins)", async () => {
    vi.mocked(searchEdamamFoods).mockResolvedValue({ foods: [mappedEdamam], reached: true });
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(storage.nutrition.upsertFoods)
      .mockResolvedValueOnce([
        food({ id: "ed1", source: "edamam", sourceId: "ed1", brand: "Clif", name: "Clif Bar" }),
      ])
      .mockResolvedValueOnce([
        food({ id: "usda1", source: "usda", sourceId: "1", brand: "Clif", name: "Clif Bar" }),
      ]);

    const result = await searchFoods("clif", "u1");
    expect(result.results.map((f) => f.id)).toEqual(["ed1"]); // USDA near-dup suppressed
  });

  it("ranks OFF results after USDA and before local, caching its hits", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([
      food({ id: "local1", source: "custom", sourceId: null }),
    ]);
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(searchOffFoods).mockResolvedValue({ foods: [mappedOff], reached: true });
    vi.mocked(storage.nutrition.upsertFoods)
      .mockResolvedValueOnce([food({ id: "usda1", source: "usda", sourceId: "1" })]) // USDA cached first
      .mockResolvedValueOnce([food({ id: "off1", source: "off", sourceId: "off1" })]); // then OFF

    const result = await searchFoods("banana", "u1");

    expect(result.apiDegraded).toBe(false);
    expect(result.results.map((f) => f.id)).toEqual(["usda1", "off1", "local1"]);
  });

  it("keeps search live (not degraded) when only OFF reaches its API", async () => {
    (env as { USDA_API_KEY?: string }).USDA_API_KEY = undefined; // USDA + Edamam unconfigured
    vi.mocked(searchOffFoods).mockResolvedValue({ foods: [], reached: true });
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);

    const result = await searchFoods("banana", "u1");
    expect(result.apiDegraded).toBe(false);
  });

  it("flags degraded only when OFF also fails to reach its API", async () => {
    (env as { USDA_API_KEY?: string }).USDA_API_KEY = undefined;
    vi.mocked(searchOffFoods).mockRejectedValue(new Error("off down"));
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);

    const result = await searchFoods("banana", "u1");
    expect(result.apiDegraded).toBe(true);
    expect(result.results.map((f) => f.id)).toEqual(["local1"]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("drops a USDA result that doesn't match the query, keeping the relevant one", async () => {
    vi.mocked(searchUsdaFoods).mockResolvedValue([
      mappedUsda, // "Banana"
      { ...mappedUsda, sourceId: "2", name: "Chocolate Bar" },
    ]);
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([
      food({ id: "usda-banana", source: "usda", sourceId: "1", name: "Banana" }),
      food({ id: "usda-choc", source: "usda", sourceId: "2", name: "Chocolate Bar" }),
    ]);

    const result = await searchFoods("banana", "u1");
    expect(result.results.map((f) => f.id)).toEqual(["usda-banana"]);
  });

  it("drops an Edamam result that doesn't match the query", async () => {
    vi.mocked(searchEdamamFoods).mockResolvedValue({
      foods: [mappedEdamam, { ...mappedEdamam, sourceId: "ed2", name: "Granola Cereal" }],
      reached: true,
    });
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([
      food({ id: "ed-banana", source: "edamam", sourceId: "ed1", name: "Banana" }),
      food({ id: "ed-granola", source: "edamam", sourceId: "ed2", name: "Granola Cereal" }),
    ]);

    const result = await searchFoods("banana", "u1");
    expect(result.results.map((f) => f.id)).toEqual(["ed-banana"]);
  });

  it("ranks a stronger name match above a weaker one from a higher-priority provider", async () => {
    vi.mocked(searchEdamamFoods).mockResolvedValue({
      foods: [{ ...mappedEdamam, name: "Banana Bread" }],
      reached: true,
    });
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]); // exact "Banana"
    vi.mocked(storage.nutrition.upsertFoods)
      .mockResolvedValueOnce([
        food({ id: "ed-bread", source: "edamam", sourceId: "ed1", name: "Banana Bread" }),
      ])
      .mockResolvedValueOnce([
        food({ id: "usda-banana", source: "usda", sourceId: "1", name: "Banana" }),
      ]);

    const result = await searchFoods("banana", "u1");
    // USDA's exact "Banana" outranks Edamam's "Banana Bread" despite the lower tier.
    expect(result.results.map((f) => f.id)).toEqual(["usda-banana", "ed-bread"]);
  });

  it("falls back to ungated results when the gate would empty everything", async () => {
    vi.mocked(searchUsdaFoods).mockResolvedValue([
      { ...mappedUsda, sourceId: "9", name: "Chocolate Bar" },
    ]);
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([
      food({ id: "usda-choc", source: "usda", sourceId: "9", name: "Chocolate Bar" }),
    ]);

    // Gate("banana") drops the only (off-topic) hit and there's no local match, so
    // the fallback surfaces it rather than returning a blank screen.
    const result = await searchFoods("banana", "u1");
    expect(result.results.map((f) => f.id)).toEqual(["usda-choc"]);
  });
});

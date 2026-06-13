import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../storage", () => ({
  storage: { nutrition: { searchLocalFoods: vi.fn(), upsertFoods: vi.fn() } },
}));
vi.mock("./usdaClient", () => ({ searchUsdaFoods: vi.fn() }));
vi.mock("./fatsecretClient", () => ({ searchFatSecretFoods: vi.fn() }));
vi.mock("./refresh", () => ({ refreshStaleFoodsInBackground: vi.fn() }));
vi.mock("../../env", () => ({ env: { USDA_API_KEY: "test-key" } }));
vi.mock("../../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { env } from "../../env";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { searchFatSecretFoods } from "./fatsecretClient";
import { searchFoods } from "./foodSearch";
import { makeFood as food } from "./foodTestFixture";
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
const mappedFs = { ...mappedUsda, source: "fatsecret" as const, sourceId: "fs1" };

describe("searchFoods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (env as { USDA_API_KEY?: string }).USDA_API_KEY = "test-key";
    // Default: FatSecret unconfigured/unreached, USDA + local empty.
    vi.mocked(searchFatSecretFoods).mockResolvedValue({ foods: [], reached: false });
    vi.mocked(searchUsdaFoods).mockResolvedValue([]);
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([]);
  });

  it("ranks FatSecret ahead of USDA ahead of local, not degraded", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1", source: "custom", sourceId: null })]);
    vi.mocked(searchFatSecretFoods).mockResolvedValue({ foods: [mappedFs], reached: true });
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(storage.nutrition.upsertFoods)
      .mockResolvedValueOnce([food({ id: "fs1", source: "fatsecret", sourceId: "fs1" })])
      .mockResolvedValueOnce([food({ id: "usda1", source: "usda", sourceId: "1" })]);

    const result = await searchFoods("banana", "u1");

    expect(result.apiDegraded).toBe(false);
    expect(result.results.map((f) => f.id)).toEqual(["fs1", "usda1", "local1"]);
  });

  it("is not degraded when USDA returns no matches but the key is set", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);

    const result = await searchFoods("banana", "u1");

    expect(result.apiDegraded).toBe(false);
    expect(storage.nutrition.upsertFoods).not.toHaveBeenCalled();
    expect(result.results.map((f) => f.id)).toEqual(["local1"]);
  });

  it("is not degraded when FatSecret reached the API even with no matches (USDA off)", async () => {
    (env as { USDA_API_KEY?: string }).USDA_API_KEY = undefined;
    vi.mocked(searchFatSecretFoods).mockResolvedValue({ foods: [], reached: true });
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

  it("returns results and is not degraded when FatSecret throws but USDA succeeds", async () => {
    vi.mocked(searchFatSecretFoods).mockRejectedValue(new Error("fs down"));
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([food({ id: "usda1" })]);

    const result = await searchFoods("banana", "u1");
    expect(result.apiDegraded).toBe(false);
    expect(result.results.map((f) => f.id)).toEqual(["usda1"]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("flags degraded and returns cache when USDA throws and FatSecret is unconfigured", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);
    vi.mocked(searchUsdaFoods).mockRejectedValue(new Error("USDA down"));

    const result = await searchFoods("banana", "u1");
    expect(result.apiDegraded).toBe(true);
    expect(result.results.map((f) => f.id)).toEqual(["local1"]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("dedupes a food present in both the live result and local cache", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "localdup", source: "usda", sourceId: "1" })]);
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([food({ id: "usda1", source: "usda", sourceId: "1" })]);

    const result = await searchFoods("banana", "u1");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe("usda1");
  });

  it("suppresses a cross-source brand+name near-duplicate (FatSecret wins)", async () => {
    vi.mocked(searchFatSecretFoods).mockResolvedValue({ foods: [mappedFs], reached: true });
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(storage.nutrition.upsertFoods)
      .mockResolvedValueOnce([food({ id: "fs1", source: "fatsecret", sourceId: "fs1", brand: "Clif", name: "Clif Bar" })])
      .mockResolvedValueOnce([food({ id: "usda1", source: "usda", sourceId: "1", brand: "Clif", name: "Clif Bar" })]);

    const result = await searchFoods("clif", "u1");
    expect(result.results.map((f) => f.id)).toEqual(["fs1"]); // USDA near-dup suppressed
  });
});

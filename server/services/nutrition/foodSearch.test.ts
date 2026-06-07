import type { Food } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../storage", () => ({
  storage: { nutrition: { searchLocalFoods: vi.fn(), upsertFoods: vi.fn() } },
}));
vi.mock("./usdaClient", () => ({ searchUsdaFoods: vi.fn() }));
vi.mock("../../env", () => ({ env: { USDA_API_KEY: "test-key" } }));
vi.mock("../../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { env } from "../../env";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { searchFoods } from "./foodSearch";
import { searchUsdaFoods } from "./usdaClient";

function food(over: Partial<Food>): Food {
  return {
    id: "id1",
    source: "usda",
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

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
};

describe("searchFoods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (env as { USDA_API_KEY?: string }).USDA_API_KEY = "test-key";
  });

  it("caches USDA hits and returns them ahead of local results", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1", sourceId: "99" })]);
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([food({ id: "usda1", sourceId: "1" })]);

    const result = await searchFoods("banana");

    expect(storage.nutrition.upsertFoods).toHaveBeenCalledOnce();
    expect(result.apiDegraded).toBe(false);
    expect(result.results.map((f) => f.id)).toEqual(["usda1", "local1"]);
  });

  it("is not degraded when USDA returns no matches but the key is set", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);
    vi.mocked(searchUsdaFoods).mockResolvedValue([]);

    const result = await searchFoods("banana");

    expect(result.apiDegraded).toBe(false);
    expect(storage.nutrition.upsertFoods).not.toHaveBeenCalled();
    expect(result.results.map((f) => f.id)).toEqual(["local1"]);
  });

  it("flags degraded when no API key is configured (cache-only)", async () => {
    (env as { USDA_API_KEY?: string }).USDA_API_KEY = undefined;
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);
    vi.mocked(searchUsdaFoods).mockResolvedValue([]);

    const result = await searchFoods("banana");

    expect(result.apiDegraded).toBe(true);
    expect(result.results).toHaveLength(1);
  });

  it("flags degraded and returns cached foods when USDA throws (NFR-5)", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([food({ id: "local1" })]);
    vi.mocked(searchUsdaFoods).mockRejectedValue(new Error("USDA down"));

    const result = await searchFoods("banana");

    expect(result.apiDegraded).toBe(true);
    expect(result.results.map((f) => f.id)).toEqual(["local1"]);
    expect(storage.nutrition.upsertFoods).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("dedupes a food present in both local cache and the USDA result", async () => {
    vi.mocked(storage.nutrition.searchLocalFoods).mockResolvedValue([
      food({ id: "localdup", source: "usda", sourceId: "1" }),
    ]);
    vi.mocked(searchUsdaFoods).mockResolvedValue([mappedUsda]);
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([food({ id: "usda1", source: "usda", sourceId: "1" })]);

    const result = await searchFoods("banana");

    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe("usda1");
  });
});

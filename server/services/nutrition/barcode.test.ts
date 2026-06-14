import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../storage", () => ({
  storage: { nutrition: { getFoodBySourceId: vi.fn(), upsertFoods: vi.fn() } },
}));
vi.mock("./spoonacularClient", () => ({ resolveSpoonacularBarcode: vi.fn() }));
vi.mock("./offClient", () => ({ resolveBarcode: vi.fn() }));
vi.mock("./refresh", () => ({ refreshStaleFoodsInBackground: vi.fn() }));
vi.mock("../../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { storage } from "../../storage";
import { lookupBarcode } from "./barcode";
import { makeFood as food } from "./foodTestFixture";
import { resolveBarcode } from "./offClient";
import { refreshStaleFoodsInBackground } from "./refresh";
import { resolveSpoonacularBarcode } from "./spoonacularClient";

const mapped = {
  source: "spoonacular" as const,
  sourceId: "555",
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

describe("lookupBarcode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a cached food without calling any provider, and kicks a refresh", async () => {
    const cached = food({ id: "cached", source: "off", sourceId: "0049000028" });
    vi.mocked(storage.nutrition.getFoodBySourceId).mockResolvedValue(cached);

    const result = await lookupBarcode("0049000028");

    expect(result).toBe(cached);
    expect(resolveSpoonacularBarcode).not.toHaveBeenCalled();
    expect(resolveBarcode).not.toHaveBeenCalled();
    expect(refreshStaleFoodsInBackground).toHaveBeenCalledWith([cached]);
  });

  it("resolves via Spoonacular on a cache miss and upserts (no OFF fallback)", async () => {
    vi.mocked(storage.nutrition.getFoodBySourceId).mockResolvedValue(undefined);
    vi.mocked(resolveSpoonacularBarcode).mockResolvedValue(mapped);
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([food({ id: "sp" })]);

    const result = await lookupBarcode("0049000028");

    expect(result?.id).toBe("sp");
    expect(resolveSpoonacularBarcode).toHaveBeenCalledOnce();
    expect(resolveBarcode).not.toHaveBeenCalled();
    expect(storage.nutrition.upsertFoods).toHaveBeenCalledWith([mapped]);
  });

  it("falls back to Open Food Facts when Spoonacular has nothing", async () => {
    vi.mocked(storage.nutrition.getFoodBySourceId).mockResolvedValue(undefined);
    vi.mocked(resolveSpoonacularBarcode).mockResolvedValue(null);
    const offMapped = { ...mapped, source: "off" as const, sourceId: "0049000028" };
    vi.mocked(resolveBarcode).mockResolvedValue(offMapped);
    vi.mocked(storage.nutrition.upsertFoods).mockResolvedValue([food({ id: "off", source: "off" })]);

    const result = await lookupBarcode("0049000028");

    expect(result?.id).toBe("off");
    expect(resolveSpoonacularBarcode).toHaveBeenCalledOnce();
    expect(resolveBarcode).toHaveBeenCalledOnce();
    expect(storage.nutrition.upsertFoods).toHaveBeenCalledWith([offMapped]);
  });

  it("returns null when neither provider recognizes the barcode", async () => {
    vi.mocked(storage.nutrition.getFoodBySourceId).mockResolvedValue(undefined);
    vi.mocked(resolveSpoonacularBarcode).mockResolvedValue(null);
    vi.mocked(resolveBarcode).mockResolvedValue(null);

    expect(await lookupBarcode("0000000000000")).toBeNull();
    expect(storage.nutrition.upsertFoods).not.toHaveBeenCalled();
  });

  it("degrades to null (no throw) when caching the resolved food fails", async () => {
    vi.mocked(storage.nutrition.getFoodBySourceId).mockResolvedValue(undefined);
    vi.mocked(resolveSpoonacularBarcode).mockResolvedValue(mapped);
    vi.mocked(storage.nutrition.upsertFoods).mockRejectedValue(new Error("constraint violation"));

    expect(await lookupBarcode("0049000028")).toBeNull();
  });
});

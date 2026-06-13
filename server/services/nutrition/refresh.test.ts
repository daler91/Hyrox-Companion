import { describe, expect, it, vi } from "vitest";

// Mock the side-effectful imports so loading refresh.ts doesn't pull in the DB.
vi.mock("../../storage", () => ({ storage: { nutrition: { upsertFoods: vi.fn() } } }));
vi.mock("../../logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("./fatsecretClient", () => ({ getFatSecretFoodById: vi.fn() }));
vi.mock("./offClient", () => ({ resolveBarcode: vi.fn() }));
vi.mock("./usdaClient", () => ({ fetchUsdaFoodById: vi.fn() }));

import { makeFood as food } from "./foodTestFixture";
import { isStaleFood, STALE_AFTER_MS } from "./refresh";

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

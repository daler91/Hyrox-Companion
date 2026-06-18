import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock every I/O edge so the gating logic is exercised in isolation (no DB / AI /
// vector calls). `env` is a mutable object reset to the "all gates open" baseline
// before each test; individual tests flip one field to assert a short-circuit.
vi.mock("../../env", () => ({
  env: { NUTRITION_SEMANTIC_ENABLED: "true", AI_FEATURES_ENABLED: "true", GEMINI_API_KEY: "k" },
}));
vi.mock("../../gemini/client", () => ({
  generateEmbedding: vi.fn(),
  trackEmbeddingUsage: vi.fn(),
}));
vi.mock("../../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../../storage", () => ({
  storage: {
    users: { getUser: vi.fn() },
    nutrition: { getVisibleFoodsByIds: vi.fn() },
  },
}));
vi.mock("../aiUsageService", () => ({ checkAiBudget: vi.fn() }));
vi.mock("./foodEmbeddings", () => ({ searchFoodIdsByEmbedding: vi.fn() }));

import { env } from "../../env";
import { generateEmbedding, trackEmbeddingUsage } from "../../gemini/client";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { checkAiBudget } from "../aiUsageService";
import { searchFoodIdsByEmbedding } from "./foodEmbeddings";
import { makeFood as food } from "./foodTestFixture";
import { maybeSemanticSearch } from "./semanticSearch";

type MutableEnv = {
  NUTRITION_SEMANTIC_ENABLED: string;
  AI_FEATURES_ENABLED: string;
  GEMINI_API_KEY: string | undefined;
};
const mutableEnv = env as unknown as MutableEnv;

/** Wire every downstream call to its happy-path value (consented, in budget, hits). */
function primeHappyPath() {
  vi.mocked(storage.users.getUser).mockResolvedValue({ aiCoachEnabled: true } as never);
  vi.mocked(checkAiBudget).mockResolvedValue({
    allowed: true,
    currentCostCents: 0,
    limitCents: 200,
    warning: false,
  });
  vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3]);
  vi.mocked(searchFoodIdsByEmbedding).mockResolvedValue(["f1", "f2", "f3"]);
  vi.mocked(storage.nutrition.getVisibleFoodsByIds).mockResolvedValue(
    new Map([
      ["f1", food({ id: "f1", name: "Chicken Breast" })],
      ["f3", food({ id: "f3", name: "Greek Yogurt" })],
    ]),
  );
}

describe("maybeSemanticSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutableEnv.NUTRITION_SEMANTIC_ENABLED = "true";
    mutableEnv.AI_FEATURES_ENABLED = "true";
    mutableEnv.GEMINI_API_KEY = "k";
  });

  it("returns matches in ANN order, dropping ids that aren't visible", async () => {
    primeHappyPath();

    const out = await maybeSemanticSearch("post workout protein", "u1", 0);

    // f2 wasn't in the visible map (deleted / cross-user) → dropped; f1, f3 keep ANN order.
    expect(out.map((f) => f.id)).toEqual(["f1", "f3"]);
    expect(storage.nutrition.getVisibleFoodsByIds).toHaveBeenCalledWith("u1", ["f1", "f2", "f3"]);
    expect(trackEmbeddingUsage).toHaveBeenCalledWith("u1", 1);
  });

  it("no-ops (no I/O) when the feature flag is off", async () => {
    mutableEnv.NUTRITION_SEMANTIC_ENABLED = "false";
    primeHappyPath();

    expect(await maybeSemanticSearch("q", "u1", 0)).toEqual([]);
    expect(storage.users.getUser).not.toHaveBeenCalled();
    expect(generateEmbedding).not.toHaveBeenCalled();
  });

  it("no-ops when the AI kill switch is off", async () => {
    mutableEnv.AI_FEATURES_ENABLED = "false";
    primeHappyPath();

    expect(await maybeSemanticSearch("q", "u1", 0)).toEqual([]);
    expect(storage.users.getUser).not.toHaveBeenCalled();
  });

  it("no-ops when no Gemini key is configured", async () => {
    mutableEnv.GEMINI_API_KEY = undefined;
    primeHappyPath();

    expect(await maybeSemanticSearch("q", "u1", 0)).toEqual([]);
    expect(generateEmbedding).not.toHaveBeenCalled();
  });

  it("skips when the keyword set already has enough results (>= floor)", async () => {
    primeHappyPath();

    expect(await maybeSemanticSearch("q", "u1", 5)).toEqual([]);
    // Result-floor is checked before any consent/budget I/O.
    expect(storage.users.getUser).not.toHaveBeenCalled();
    expect(generateEmbedding).not.toHaveBeenCalled();
  });

  it("skips a user who hasn't consented to AI", async () => {
    primeHappyPath();
    vi.mocked(storage.users.getUser).mockResolvedValue({ aiCoachEnabled: false } as never);

    expect(await maybeSemanticSearch("q", "u1", 0)).toEqual([]);
    expect(generateEmbedding).not.toHaveBeenCalled();
  });

  it("skips a user who is over their daily AI budget", async () => {
    primeHappyPath();
    vi.mocked(checkAiBudget).mockResolvedValue({
      allowed: false,
      currentCostCents: 250,
      limitCents: 200,
      warning: true,
    });

    expect(await maybeSemanticSearch("q", "u1", 0)).toEqual([]);
    expect(generateEmbedding).not.toHaveBeenCalled();
  });

  it("returns [] (no match) when the vector search finds nothing", async () => {
    primeHappyPath();
    vi.mocked(searchFoodIdsByEmbedding).mockResolvedValue([]);

    expect(await maybeSemanticSearch("q", "u1", 0)).toEqual([]);
    expect(storage.nutrition.getVisibleFoodsByIds).not.toHaveBeenCalled();
  });

  it("degrades silently to [] when the embedding/vector call throws", async () => {
    primeHappyPath();
    vi.mocked(generateEmbedding).mockRejectedValue(new Error("gemini down"));

    expect(await maybeSemanticSearch("q", "u1", 0)).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });
});

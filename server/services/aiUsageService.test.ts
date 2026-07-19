import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../storage", () => ({
  storage: { aiUsage: { insertUsageLog: vi.fn(), getDailyTotalCents: vi.fn() } },
}));
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { logger } from "../logger";
import { estimateCostCents } from "./aiUsageService";

const M = 1_000_000;

describe("estimateCostCents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["gemini-2.5-flash-lite", 37.5],
    ["gemini-2.5-flash", 280],
    ["gemini-3.1-pro-preview", 1125],
    ["gemini-embedding-001", 1],
    ["claude-sonnet-4-5", 1800],
  ])("prices %s at 1M in / 1M out", (model, expectedCents) => {
    expect(estimateCostCents(model, M, M)).toBeCloseTo(expectedCents, 5);
  });

  it("scales linearly with fractional token counts", () => {
    // gemini-2.5-flash: 250k in * $0.30/M + 50k out * $2.50/M = $0.075 + $0.125 = 20 cents
    expect(estimateCostCents("gemini-2.5-flash", 250_000, 50_000)).toBeCloseTo(20, 5);
  });

  it("falls back to conservative DEFAULT_PRICING for unknown models and warns once", () => {
    // (1M/1M * $5) + (1M/1M * $25) = $30 = 3000 cents
    expect(estimateCostCents("made-up-model-a", M, M)).toBeCloseTo(3000, 5);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { model: "made-up-model-a" },
      expect.stringContaining("no MODEL_PRICING entry"),
    );

    // Same unknown model again: costed the same, but not warned again
    // (the warned-set is module-level, so this must stay within one test).
    expect(estimateCostCents("made-up-model-a", M, M)).toBeCloseTo(3000, 5);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("prices every env-default model without hitting the fallback", () => {
    // The Gemini defaults from server/env.ts:93-95 plus EMBEDDING_MODEL
    // (server/gemini/client.ts) — hardcoded rather than importing server/env,
    // whose zod validation requires real environment variables. If a default
    // changes, add its pricing to MODEL_PRICING and update this list.
    const envDefaultModels = [
      "gemini-2.5-flash-lite",
      "gemini-3.1-pro-preview",
      "gemini-2.5-flash",
      "gemini-embedding-001",
    ];
    for (const model of envDefaultModels) {
      estimateCostCents(model, M, M);
    }
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

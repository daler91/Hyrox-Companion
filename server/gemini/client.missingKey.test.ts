import { beforeEach, describe, expect, it, vi } from "vitest";

// AI2 (CODEBASE_ANALYSIS_2026-10-03): text on Anthropic with no Gemini key is a
// documented setup. Every other client test configures a key, which is why one
// coaching-material upload opening the breaker for every athlete's chat went
// unseen.
vi.mock("../env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../env")>();
  return {
    ...actual,
    env: { ...actual.env, AI_TEXT_PROVIDER: "anthropic", GEMINI_API_KEY: undefined },
  };
});

vi.mock("../sharedRuntimeState", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sharedRuntimeState")>()),
  getRuntimeCache: vi.fn(() => Promise.resolve()),
  setRuntimeCache: vi.fn(() => Promise.resolve()),
}));

vi.mock("../services/aiUsageService", () => ({ recordAiUsage: vi.fn(() => Promise.resolve()) }));

import {
  __resetCircuitBreakerForTests,
  CircuitBreakerOpenError,
  embeddingBreaker,
  textBreakerFor,
} from "../ai/circuitBreaker";
import { AiConfigurationError } from "../ai/errors";
import { __resetEmbeddingCacheForTests, generateEmbedding, generateEmbeddings } from "./client";

describe("embeddings with no GEMINI_API_KEY", () => {
  beforeEach(() => {
    __resetCircuitBreakerForTests();
    __resetEmbeddingCacheForTests();
  });

  it("fails an upload's embeddings as a configuration error, leaving the chat provider's breaker closed", async () => {
    const chunks = ["chunk 1", "chunk 2", "chunk 3", "chunk 4", "chunk 5"];
    await expect(generateEmbeddings(chunks)).rejects.toBeInstanceOf(AiConfigurationError);

    expect(() => {
      textBreakerFor("anthropic").assertClosed();
    }).not.toThrow();
    expect(() => {
      embeddingBreaker.assertClosed();
    }).not.toThrow();
  });

  it("keeps saying what is wrong rather than reporting a provider outage", async () => {
    for (let i = 0; i < 6; i++) {
      const error: unknown = await generateEmbedding(`chunk ${String(i)}`).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(AiConfigurationError);
      expect(error).not.toBeInstanceOf(CircuitBreakerOpenError);
    }
  });
});

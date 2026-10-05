import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getAiClient() bails if env.GEMINI_API_KEY is unset; env.ts freezes its
// value at module load (Zod safeParse), so setting process.env from here
// would be too late. Mock the module directly — we only need a non-empty
// key to pass the guard.
vi.mock("../env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../env")>();
  return {
    ...actual,
    env: { ...actual.env, GEMINI_API_KEY: "test-gemini-key" },
  };
});

const embedContentSpy = vi.fn();

// Stub the SDK entry point so `getAiClient()` returns a harness instead of
// trying to hit the real Gemini endpoint. The module's own `generateEmbedding`
// reaches the SDK via `new GoogleGenAI({...}).models.embedContent`, so the
// mock must intercept that constructor.
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(function () {
    return { models: { embedContent: embedContentSpy } };
  }),
}));

vi.mock("../services/aiUsageService", () => ({ recordAiUsage: vi.fn(() => Promise.resolve()) }));

import { embeddingBreaker } from "../ai/circuitBreaker";
import { recordAiUsage } from "../services/aiUsageService";
import { __resetEmbeddingCacheForTests, generateEmbedding, retryWithBackoff, trackUsageFromResponse, withTimeout } from "./client";

function mockEmbedding(values: number[]) {
  embedContentSpy.mockResolvedValueOnce({ embeddings: [{ values }] });
}

describe("generateEmbedding cache", () => {
  beforeEach(() => {
    embedContentSpy.mockReset();
    __resetEmbeddingCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns cached values without re-billing on a second identical call", async () => {
    mockEmbedding([1, 2, 3]);

    const first = await generateEmbedding("hello world");
    const second = await generateEmbedding("hello world");

    expect(first).toEqual([1, 2, 3]);
    expect(second).toEqual([1, 2, 3]);
    expect(embedContentSpy).toHaveBeenCalledOnce();
  });

  it("trims whitespace so leading/trailing padding hits the same cache key", async () => {
    mockEmbedding([0.1, 0.2]);
    await generateEmbedding("  spaced out  ");
    await generateEmbedding("spaced out");
    expect(embedContentSpy).toHaveBeenCalledOnce();
  });

  it("re-queries Gemini when the cached entry has expired past the 1h TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

    mockEmbedding([1, 1, 1]);
    await generateEmbedding("stale");

    vi.setSystemTime(new Date("2025-01-01T01:00:01Z"));
    mockEmbedding([2, 2, 2]);
    const refreshed = await generateEmbedding("stale");

    expect(refreshed).toEqual([2, 2, 2]);
    expect(embedContentSpy).toHaveBeenCalledTimes(2);
  });
});

describe("withTimeout (S6)", () => {
  it("resolves with the value when the promise settles before the timeout", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000, "fast")).resolves.toBe("ok");
  });

  it("rejects and fires onTimeout when the timer wins", async () => {
    const onTimeout = vi.fn();
    const never = new Promise<never>(() => {});
    await expect(withTimeout(never, 10, "slow", onTimeout)).rejects.toThrow(/timed out/);
    expect(onTimeout).toHaveBeenCalledOnce();
  });
});

describe("retryWithBackoff abort plumbing (S6)", () => {
  it("aborts the signal handed to fn when the call times out", async () => {
    let captured: AbortSignal | undefined;
    const result = retryWithBackoff(
      (signal) => {
        captured = signal;
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted by signal")));
        });
      },
      "abort-test",
      embeddingBreaker,
      // Fail fast, with a call timeout short enough to fire.
      { maxRetries: 0, baseDelayMs: 1, budgetMs: 1000, callTimeoutMs: 15 },
    );
    await expect(result).rejects.toThrow();
    expect(captured?.aborted).toBe(true);
  });
});

// AI4 (CODEBASE_ANALYSIS_2026-10-03): the vision parsers record through this,
// and gemini-2.5-flash thinks by default.
describe("trackUsageFromResponse", () => {
  beforeEach(() => {
    vi.mocked(recordAiUsage).mockClear();
  });

  it("records thinking tokens as output, so they are costed against the budget", () => {
    trackUsageFromResponse("user-1", "gemini-2.5-flash", "parse", {
      usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300, thoughtsTokenCount: 900 },
    } as never);

    expect(recordAiUsage).toHaveBeenCalledWith("user-1", "gemini-2.5-flash", "parse", 1200, 1200);
  });

  it("records zero tokens when the response carries no usage", () => {
    trackUsageFromResponse("user-1", "gemini-2.5-flash", "parse", {} as never);

    expect(recordAiUsage).toHaveBeenCalledWith("user-1", "gemini-2.5-flash", "parse", 0, 0);
  });
});

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
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { embedContent: embedContentSpy },
  })),
}));

import { __resetEmbeddingCacheForTests, generateEmbedding } from "./client";

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

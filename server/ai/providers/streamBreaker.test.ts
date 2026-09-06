import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetCircuitBreakerForTests,
  CircuitBreakerOpenError,
} from "../circuitBreaker";

// ---------------------------------------------------------------------------
// Streaming can't be retried — a retry would re-emit text the caller already
// received — so it deliberately skips retryWithBackoff. retryWithBackoff was
// also the only thing driving the circuit breaker, which left streaming
// invisible to it in both directions. These tests pin the participation.
// ---------------------------------------------------------------------------

const { streamChunks } = vi.hoisted(() => ({ streamChunks: vi.fn() }));

vi.mock("../sharedRuntimeState", () => ({
  getRuntimeCache: vi.fn().mockResolvedValue(undefined),
  setRuntimeCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./config", () => ({
  getTextAiConfig: () => ({ provider: "gemini" }),
  resolveTextAiModel: () => "test-model",
  configuredTextProviderHasApiKey: () => true,
}));

vi.mock("./gemini", () => ({
  geminiTextProvider: {
    generateText: vi.fn(),
    streamText: (request: unknown) => streamChunks(request),
  },
}));

vi.mock("../../services/aiUsageService", () => ({ recordAiUsage: vi.fn() }));

import { __resetTextAiProviderForTests, streamText } from "./index";

/** Drain a stream, returning the text or the error it threw. */
async function drain(): Promise<{ text: string } | { error: unknown }> {
  try {
    let text = "";
    for await (const chunk of streamText({ label: "unit", messages: [] } as never)) {
      text += chunk;
    }
    return { text };
  } catch (error) {
    return { error };
  }
}

function respondWith(chunks: string[]) {
  streamChunks.mockImplementation(async function* () {
    for (const text of chunks) yield { text, model: "test-model" };
  });
}

function failWith(error: Error) {
  streamChunks.mockImplementation(async function* () {
    yield { text: "partial", model: "test-model" };
    throw error;
  });
}

describe("streamText participates in the AI circuit breaker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetCircuitBreakerForTests();
    __resetTextAiProviderForTests();
  });

  it("counts stream failures toward opening the breaker", async () => {
    failWith(new Error("503 upstream unavailable"));

    // FAILURE_THRESHOLD is 5.
    for (let i = 0; i < 5; i++) await drain();
    const result = await drain();

    expect(result).toMatchObject({ error: expect.any(CircuitBreakerOpenError) });
  });

  it("fast-fails without touching the provider once the breaker is open", async () => {
    failWith(new Error("503 upstream unavailable"));
    for (let i = 0; i < 5; i++) await drain();
    streamChunks.mockClear();

    const result = await drain();

    expect(result).toMatchObject({ error: expect.any(CircuitBreakerOpenError) });
    // The point of the breaker: an outage stops costing a round-trip per call.
    expect(streamChunks).not.toHaveBeenCalled();
  });

  it("lets a completed stream reset the failure run", async () => {
    failWith(new Error("503 upstream unavailable"));
    for (let i = 0; i < 4; i++) await drain();

    respondWith(["hello ", "world"]);
    await expect(drain()).resolves.toEqual({ text: "hello world" });

    // Four more failures would trip a counter that had not been reset.
    failWith(new Error("503 upstream unavailable"));
    for (let i = 0; i < 4; i++) await drain();
    respondWith(["still up"]);

    await expect(drain()).resolves.toEqual({ text: "still up" });
  });

  it("does not let a malformed request open the breaker for everyone else", async () => {
    // One caller's bad prompt says nothing about the provider's health.
    failWith(Object.assign(new Error("invalid request: bad tool schema"), { status: 400 }));
    for (let i = 0; i < 8; i++) await drain();

    respondWith(["healthy"]);
    await expect(drain()).resolves.toEqual({ text: "healthy" });
  });
});

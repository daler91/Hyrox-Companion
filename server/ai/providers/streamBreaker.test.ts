import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __circuitBreakerInternalsForTests,
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

// AI5 (CODEBASE_ANALYSIS_2026-10-03): a stream its caller cancels — the
// athlete's Stop or disconnect, the SSE deadline, a shutdown drain — ends in
// the AbortError fetch rejects the pending read with, which says nothing
// about the provider.
describe("a stream its caller cancelled, and the circuit breaker", () => {
  const abortError = () => new DOMException("This operation was aborted", "AbortError");

  /** The provider sends a first piece, then rejects its pending read with an AbortError once `signal` aborts. */
  function rejectsOnAbort() {
    streamChunks.mockImplementation(async function* (request: { signal?: AbortSignal }) {
      yield { text: "partial", model: "test-model" };
      const signal = request.signal;
      if (signal && !signal.aborted) {
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      }
      throw abortError();
    });
  }

  /** Read the first piece, then cancel, as the chat route does on Stop. */
  async function drainAndCancel(): Promise<unknown> {
    const controller = new AbortController();
    try {
      for await (const _chunk of streamText({ label: "unit", messages: [], signal: controller.signal } as never)) {
        controller.abort();
      }
    } catch (error) {
      return error;
    }
    return undefined;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    __resetCircuitBreakerForTests();
    __resetTextAiProviderForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never opens the breaker, however many times it happens", async () => {
    rejectsOnAbort();
    for (let i = 0; i < 8; i++) {
      await expect(drainAndCancel()).resolves.toMatchObject({ name: "AbortError" });
    }

    respondWith(["healthy"]);
    await expect(drain()).resolves.toEqual({ text: "healthy" });
  });

  it("neither counts as a failure nor resets the run a provider 503 started", async () => {
    failWith(new Error("503 upstream unavailable"));
    for (let i = 0; i < 4; i++) await drain();

    rejectsOnAbort();
    for (let i = 0; i < 3; i++) await drainAndCancel();

    // The fifth real failure still opens it: the cancels were neutral both ways.
    failWith(new Error("503 upstream unavailable"));
    await drain();
    await expect(drain()).resolves.toMatchObject({ error: expect.any(CircuitBreakerOpenError) });
  });

  it("still counts an AbortError the caller didn't ask for, such as the provider's own timeout", async () => {
    // Told apart by the caller's signal, not by the error's name or message.
    failWith(abortError());
    for (let i = 0; i < 5; i++) await drain();

    await expect(drain()).resolves.toMatchObject({ error: expect.any(CircuitBreakerOpenError) });
  });

  it("gives back a half-open probe it cancelled, without re-opening the breaker", async () => {
    vi.useFakeTimers();
    failWith(new Error("503 upstream unavailable"));
    for (let i = 0; i < 5; i++) await drain();
    vi.advanceTimersByTime(30_000); // COOLDOWN_MS: the next call is the probe.

    rejectsOnAbort();
    await drainAndCancel();

    expect(__circuitBreakerInternalsForTests.isProbeInFlight()).toBe(false);
    respondWith(["back up"]);
    await expect(drain()).resolves.toEqual({ text: "back up" });
  });
});

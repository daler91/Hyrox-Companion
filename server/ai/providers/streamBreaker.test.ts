import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetCircuitBreakerForTests,
  CircuitBreakerOpenError,
  textBreakerFor,
} from "../circuitBreaker";

// ---------------------------------------------------------------------------
// Streaming can't be retried — a retry would re-emit text the caller already
// received — so it deliberately skips retryWithBackoff. retryWithBackoff was
// also the only thing driving the circuit breaker, which left streaming
// invisible to it in both directions. These tests pin the participation.
// ---------------------------------------------------------------------------

const { streamChunks, setRuntimeCache } = vi.hoisted(() => ({
  streamChunks: vi.fn(),
  setRuntimeCache: vi.fn(() => Promise.resolve()),
}));

// The breaker persists its transitions through server/sharedRuntimeState. This
// mock used to name "../sharedRuntimeState" — a file that does not exist from
// here — so it replaced nothing and every transition quietly tried, and
// failed, to write to the unit lane's dummy DATABASE_URL — AI20
// (CODEBASE_ANALYSIS_2026-10-03).
vi.mock("../../sharedRuntimeState", () => ({
  getRuntimeCache: vi.fn(() => Promise.resolve()),
  setRuntimeCache,
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
    // Through the mock above, not a database.
    expect(setRuntimeCache).toHaveBeenCalledWith(
      "ai-circuit-breaker:text:gemini",
      expect.objectContaining({ state: "open" }),
      expect.any(Number),
    );
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

// AI18 (CODEBASE_ANALYSIS_2026-10-03): half-open let every stream through, not
// just the one probe.
describe("a half-open breaker and streams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetCircuitBreakerForTests();
    __resetTextAiProviderForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fails a second stream fast, without touching the provider, while the probe streams", async () => {
    failWith(new Error("503 upstream unavailable"));
    for (let i = 0; i < 5; i++) await drain();
    vi.advanceTimersByTime(30_000); // COOLDOWN_MS: the next call is the probe.

    let finishProbe: ((value: unknown) => void) | undefined;
    const probeHeld = new Promise((resolve) => {
      finishProbe = resolve;
    });
    streamChunks.mockImplementationOnce(async function* () {
      yield { text: "probe ", model: "test-model" };
      await probeHeld;
      yield { text: "done", model: "test-model" };
    });
    const probe = streamText({ label: "unit", messages: [] } as never);
    await expect(probe.next()).resolves.toEqual({ value: "probe ", done: false });
    respondWith(["let through"]);
    streamChunks.mockClear();

    await expect(drain()).resolves.toMatchObject({ error: expect.any(CircuitBreakerOpenError) });
    expect(streamChunks).not.toHaveBeenCalled();

    // The probe's success closes the breaker for everyone.
    finishProbe?.(null);
    const rest: string[] = [];
    for await (const text of probe) rest.push(text);
    expect(rest).toEqual(["done"]);
    await expect(drain()).resolves.toEqual({ text: "let through" });
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

    expect(textBreakerFor("gemini").probeStateForTests().inFlight).toBe(false);
    respondWith(["back up"]);
    await expect(drain()).resolves.toEqual({ text: "back up" });
  });
});

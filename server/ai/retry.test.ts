import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetCircuitBreakerForTests,
  CircuitBreakerOpenError,
  embeddingBreaker,
  textBreakerFor,
} from "./circuitBreaker";
import { AiConfigurationError } from "./errors";
import { isRetryableError, retryWithBackoff } from "./retry";

const breaker = textBreakerFor("gemini");

/**
 * server/gemini.test.ts already exercises retryWithBackoff/isRetryableError
 * through the gemini/client.ts re-export for the common retry/backoff/timeout
 * paths. This file covers what that re-export doesn't: the word-boundary
 * status-code matching (a message containing "1500ms" must not be mistaken
 * for a "500" status) and the breaker interplay retryWithBackoff itself is
 * responsible for (fast-fail when already open, and not double-counting a
 * CircuitBreakerOpenError that surfaces mid-flight).
 */
describe("isRetryableError — word-boundary status matching", () => {
  it("does not treat a duration like '1500ms' as a 500 status", () => {
    // No "timeout"/"network"/etc keyword here — this message is retryable
    // only if the digits inside "1500ms" wrongly match the bare "500" check.
    expect(isRetryableError(new Error("Request took 1500ms and was rejected"))).toBe(false);
  });

  it("still matches a genuine 500 status", () => {
    expect(isRetryableError(new Error("500 Internal Server Error"))).toBe(true);
  });

  it("does not treat '4290' or '14291' as a 429 status", () => {
    expect(isRetryableError(new Error("order 4290 failed to save"))).toBe(false);
    expect(isRetryableError(new Error("id 14291 not found"))).toBe(false);
  });

  it("still matches a genuine 429 status", () => {
    expect(isRetryableError(new Error("HTTP 429 Too Many Requests"))).toBe(true);
  });
});

describe("retryWithBackoff — circuit breaker interplay", () => {
  beforeEach(() => {
    __resetCircuitBreakerForTests();
  });

  it("fails fast without calling fn when the breaker is already open", async () => {
    // Trip the breaker for real (FAILURE_THRESHOLD is 5) rather than mocking
    // the breaker's assertClosed, so this pins the actual integration.
    for (let i = 0; i < 5; i++) breaker.recordFailure();

    const fn = vi.fn();
    await expect(retryWithBackoff(fn, "breaker-open-test", breaker, 2, 1)).rejects.toBeInstanceOf(
      CircuitBreakerOpenError,
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it("propagates a CircuitBreakerOpenError raised mid-flight without retrying it", async () => {
    // A nested AI call (e.g. a provider fan-out) can throw this itself once
    // the breaker trips between attempts; it must not be treated as a
    // generic retryable/non-retryable failure and looped on.
    const fn = vi.fn().mockRejectedValue(new CircuitBreakerOpenError());
    await expect(retryWithBackoff(fn, "mid-flight-test", breaker, 3, 1)).rejects.toBeInstanceOf(
      CircuitBreakerOpenError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// AI5 (CODEBASE_ANALYSIS_2026-10-03): a call its caller cancelled (the
// athlete's Stop, a stream deadline, a shutdown) says nothing about the
// provider's health. Told by the caller's own signal.
describe("retryWithBackoff — a call its caller cancelled", () => {
  beforeEach(() => {
    __resetCircuitBreakerForTests();
  });

  it("is neither retried nor counted toward opening the breaker", async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn().mockRejectedValue(new DOMException("This operation was aborted", "AbortError"));

    for (let i = 0; i < 6; i++) {
      await expect(retryWithBackoff(fn, "cancelled-test", breaker, 3, 1, 1_000, 1_000, controller.signal)).rejects.toMatchObject({
        name: "AbortError",
      });
    }

    expect(fn).toHaveBeenCalledTimes(6);
    await expect(retryWithBackoff(() => Promise.resolve("ok"), "after-cancels-test", breaker, 0, 1)).resolves.toBe("ok");
  });

  it("still counts a provider failure while the caller is still waiting", async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockRejectedValue(new Error("503 Service Unavailable"));

    for (let i = 0; i < 5; i++) {
      await expect(retryWithBackoff(fn, "outage-test", breaker, 0, 1, 1_000, 1_000, controller.signal)).rejects.toThrow("503");
    }

    await expect(retryWithBackoff(fn, "outage-test", breaker, 0, 1)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
  });
});

// AI2 (CODEBASE_ANALYSIS_2026-10-03): with AI_TEXT_PROVIDER=anthropic and no
// GEMINI_API_KEY, one coaching-material upload's five failing embedding calls
// opened the one shared breaker, and every athlete's chat failed for 30 s.
describe("retryWithBackoff — the breaker each call goes through", () => {
  beforeEach(() => {
    __resetCircuitBreakerForTests();
  });

  it("does not count a call this deployment isn't configured to make", async () => {
    const fn = vi.fn().mockRejectedValue(new AiConfigurationError("GEMINI_API_KEY is required for AI features"));

    for (let i = 0; i < 6; i++) {
      await expect(retryWithBackoff(fn, "embedding", embeddingBreaker, 3, 1)).rejects.toBeInstanceOf(AiConfigurationError);
    }

    // Not retried (it would fail the same way), and never fast-failed by an open breaker.
    expect(fn).toHaveBeenCalledTimes(6);
  });

  it("leaves the text provider's calls alone while embeddings are failing", async () => {
    const outage = vi.fn().mockRejectedValue(new Error("503 Service Unavailable"));
    for (let i = 0; i < 5; i++) {
      await expect(retryWithBackoff(outage, "embedding", embeddingBreaker, 0, 1)).rejects.toThrow("503");
    }
    await expect(retryWithBackoff(outage, "embedding", embeddingBreaker, 0, 1)).rejects.toBeInstanceOf(
      CircuitBreakerOpenError,
    );

    const chat = vi.fn().mockResolvedValue("reply");
    await expect(retryWithBackoff(chat, "chat", textBreakerFor("anthropic"), 0, 1)).resolves.toBe("reply");
    expect(chat).toHaveBeenCalledOnce();
  });
});

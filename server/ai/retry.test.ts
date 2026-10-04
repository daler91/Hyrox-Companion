import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetCircuitBreakerForTests,
  CircuitBreakerOpenError,
  recordBreakerFailure,
} from "./circuitBreaker";
import { isRetryableError, retryWithBackoff } from "./retry";

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
    // assertBreakerClosed, so this pins the actual integration.
    for (let i = 0; i < 5; i++) recordBreakerFailure();

    const fn = vi.fn();
    await expect(retryWithBackoff(fn, "breaker-open-test", 2, 1)).rejects.toBeInstanceOf(
      CircuitBreakerOpenError,
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it("propagates a CircuitBreakerOpenError raised mid-flight without retrying it", async () => {
    // A nested AI call (e.g. a provider fan-out) can throw this itself once
    // the breaker trips between attempts; it must not be treated as a
    // generic retryable/non-retryable failure and looped on.
    const fn = vi.fn().mockRejectedValue(new CircuitBreakerOpenError());
    await expect(retryWithBackoff(fn, "mid-flight-test", 3, 1)).rejects.toBeInstanceOf(
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
      await expect(retryWithBackoff(fn, "cancelled-test", 3, 1, 1_000, 1_000, controller.signal)).rejects.toMatchObject({
        name: "AbortError",
      });
    }

    expect(fn).toHaveBeenCalledTimes(6);
    await expect(retryWithBackoff(() => Promise.resolve("ok"), "after-cancels-test", 0, 1)).resolves.toBe("ok");
  });

  it("still counts a provider failure while the caller is still waiting", async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockRejectedValue(new Error("503 Service Unavailable"));

    for (let i = 0; i < 5; i++) {
      await expect(retryWithBackoff(fn, "outage-test", 0, 1, 1_000, 1_000, controller.signal)).rejects.toThrow("503");
    }

    await expect(retryWithBackoff(fn, "outage-test", 0, 1)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
  });
});

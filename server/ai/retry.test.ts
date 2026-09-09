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

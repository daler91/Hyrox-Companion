import { randomInt } from "node:crypto";

import { AI_CALL_TIMEOUT_MS, AI_REQUEST_TIMEOUT_MS } from "../constants";
import { logger } from "../logger";
import {
  assertBreakerClosed,
  CircuitBreakerOpenError,
  recordBreakerFailure,
  recordBreakerSuccess,
} from "./circuitBreaker";

// Provider-neutral retry and timeout core shared by every text AI provider
// (A2). Keep this module free of provider SDK imports so a policy change here
// is visibly shared rather than inherited from one provider's client.

/**
 * Race a promise against a timeout; rejects with a descriptive error on expiry.
 * `onTimeout` (S6) fires when the timer wins so callers can abort the underlying
 * request — the race alone only rejects the wrapper, leaving the socket in flight.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string, onTimeout?: () => void): Promise<T> {
  let timerId: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timerId)),
    new Promise<never>((_, reject) => {
      timerId = setTimeout(() => {
        onTimeout?.();
        reject(new Error(`AI call timed out after ${ms}ms (${label})`));
      }, ms);
    }),
  ]);
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("429") || msg.includes("rate limit")) return true;
    if (
      msg.includes("500") ||
      msg.includes("503") ||
      msg.includes("internal server error")
    )
      return true;
    if (
      msg.includes("network") ||
      msg.includes("econnreset") ||
      msg.includes("timeout") ||
      msg.includes("fetch failed")
    )
      return true;
  }
  return false;
}

function shouldRetry(error: unknown, attempt: number, maxRetries: number, baseDelayMs: number, deadline: number): number | false {
  if (attempt >= maxRetries || !isRetryableError(error)) return false;
  const base = baseDelayMs * Math.pow(2, attempt);
  const jitter = randomInt(0, Math.max(1, Math.min(250, Math.ceil(base * 0.1))));
  const delay = base + jitter;
  if (Date.now() + delay >= deadline) return false;
  return delay;
}

export async function retryWithBackoff<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  label: string,
  maxRetries: number = 4,
  baseDelayMs: number = 2000,
  budgetMs: number = AI_REQUEST_TIMEOUT_MS,
  callTimeoutMs: number = AI_CALL_TIMEOUT_MS,
): Promise<T> {
  // Fast-fail when the breaker is open so prolonged outages don't amplify
  // latency across every caller (CODEBASE_AUDIT.md §5). Breaker open error
  // is not retryable — bail immediately so upstream queues can back off.
  assertBreakerClosed();

  const deadline = Date.now() + budgetMs;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (Date.now() >= deadline) {
      throw (lastError instanceof Error ? lastError : new Error(`AI request budget exhausted for ${label}`));
    }
    try {
      const remaining = deadline - Date.now();
      // S6: drive an AbortController off the per-call timeout and hand its
      // signal to fn so a hung provider request actually releases its socket
      // (where the SDK honors the signal) instead of lingering until the OS
      // keepalive — the Promise.race below only rejects the wrapper.
      const controller = new AbortController();
      const result = await withTimeout(
        fn(controller.signal),
        Math.min(remaining, callTimeoutMs),
        label,
        () => controller.abort(new Error(`AI call timed out (${label})`)),
      );
      recordBreakerSuccess();
      return result;
    } catch (error) {
      lastError = error;
      // A breaker-open error thrown mid-flight (from nested retryWithBackoff
      // call) should propagate without counting again.
      if (error instanceof CircuitBreakerOpenError) throw error;
      const delay = shouldRetry(error, attempt, maxRetries, baseDelayMs, deadline);
      if (delay === false) break;
      logger.warn("[ai] provider request failed; retry scheduled");
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  // Only count a logical failure (after all retries exhausted) against the
  // breaker — individual retry attempts should not accelerate tripping.
  recordBreakerFailure();
  throw lastError;
}

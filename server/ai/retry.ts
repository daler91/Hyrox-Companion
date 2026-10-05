import { randomInt } from "node:crypto";

import { AI_CALL_TIMEOUT_MS, AI_REQUEST_TIMEOUT_MS } from "../constants";
import { logger } from "../logger";
import { type AiCircuitBreaker, CircuitBreakerOpenError } from "./circuitBreaker";

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
      // `ms` is a server constant or a caller-supplied budget, never request
      // data, so the DevSkim untrusted-delay review does not apply here.
      timerId = setTimeout(() => { // DevSkim: ignore DS172411
        onTimeout?.();
        reject(new Error(`AI call timed out after ${ms}ms (${label})`));
      }, ms);
    }),
  ]);
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Status numbers are word-bounded: an unanchored `includes("500")` also
    // matches the "1500ms" in this module's own timeout message.
    if (/\b429\b/.test(msg) || msg.includes("rate limit")) return true;
    if (/\b(?:500|503)\b/.test(msg) || msg.includes("internal server error"))
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

/** How one retried call is paced and bounded; every field has a default. */
export interface RetryOptions {
  /** Retries after the first attempt (default 4). */
  readonly maxRetries?: number;
  /** First backoff delay, doubled per retry (default 2 s). */
  readonly baseDelayMs?: number;
  /** Total time across every attempt and backoff (default `AI_REQUEST_TIMEOUT_MS`). */
  readonly budgetMs?: number;
  /** Cap on a single attempt (default `AI_CALL_TIMEOUT_MS`). */
  readonly callTimeoutMs?: number;
  /** The caller's own cancel signal, which `fn` already honours; see the catch below. */
  readonly callerSignal?: AbortSignal;
}

export async function retryWithBackoff<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  label: string,
  /**
   * The breaker for this call's provider and capability (`textBreakerFor`,
   * `embeddingBreaker`, `visionBreaker`). Required, so no call lands on a
   * breaker it shares with an unrelated provider — AI2 (CODEBASE_ANALYSIS_2026-10-03).
   */
  breaker: AiCircuitBreaker,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 4,
    baseDelayMs = 2000,
    budgetMs = AI_REQUEST_TIMEOUT_MS,
    callTimeoutMs = AI_CALL_TIMEOUT_MS,
    callerSignal,
  } = options;
  // Fast-fail when the breaker is open so prolonged outages don't amplify
  // latency across every caller (CODEBASE_AUDIT.md §5). Breaker open error
  // is not retryable — bail immediately so upstream queues can back off.
  breaker.assertClosed();

  const deadline = Date.now() + budgetMs;
  // One attempt, then — after its backoff — the next, while the failure is
  // worth retrying. Recursive rather than a loop: each attempt only starts
  // once the one before it has failed.
  const attemptCall = async (attempt: number, lastError?: unknown): Promise<T> => {
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
      breaker.recordSuccess();
      return result;
    } catch (error) {
      // A breaker-open error thrown mid-flight (from nested retryWithBackoff
      // call) should propagate without counting again.
      if (error instanceof CircuitBreakerOpenError) throw error;
      // The caller cancelled it: nothing to retry, and no word on the
      // provider's health, unlike the per-call timeout, which still counts —
      // AI5 (CODEBASE_ANALYSIS_2026-10-03).
      if (callerSignal?.aborted) {
        breaker.releaseProbe();
        throw error;
      }
      const delay = shouldRetry(error, attempt, maxRetries, baseDelayMs, deadline);
      if (delay === false) {
        // Only count a logical failure (after all retries exhausted) against
        // the breaker — individual retry attempts should not accelerate
        // tripping. The error goes with it so a request the provider rejected
        // as malformed doesn't push the breaker toward cutting off every
        // other caller.
        breaker.recordFailure(error);
        throw error;
      }
      logger.warn("[ai] provider request failed; retry scheduled");
      await new Promise((resolve) => setTimeout(resolve, delay));
      return await attemptCall(attempt + 1, error);
    }
  };
  return await attemptCall(0);
}

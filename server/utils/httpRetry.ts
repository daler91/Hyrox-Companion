import { randomInt } from "node:crypto";

import { logger } from "../logger";

/**
 * Bounded retry with jittered exponential backoff for outbound HTTP calls.
 *
 * Rationale (CODEBASE_AUDIT.md §5): Strava's external API has timeout
 * protection but no retry strategy for transient 5xx / 429 responses, so
 * a single provider hiccup surfaces as a user-visible failure even though
 * a retry a few hundred ms later would have succeeded.
 *
 * Retries when `fn` throws a RetryableHttpError (callers classify 429 / 5xx
 * responses and throw the typed error) OR a transient network failure /
 * request timeout (AbortSignal.timeout's TimeoutError, ECONNRESET, ETIMEDOUT,
 * EAI_AGAIN, …). Everything else — 4xx client errors and deliberate AbortError
 * cancellations (e.g. a client disconnect) — propagates immediately so we never
 * retry a non-transient failure or a request the caller intentionally aborted.
 */

export class RetryableHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(status: number, retryAfterMs: number | null = null, message?: string) {
    super(message ?? `Retryable HTTP ${status}`);
    this.name = "RetryableHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

// Transient socket / DNS failures and request timeouts worth a retry. Node's
// fetch surfaces low-level errors as a TypeError whose `cause` carries the
// errno code; AbortSignal.timeout() rejects with a DOMException named
// "TimeoutError" (distinct from a deliberate AbortError, which we never retry).
const TRANSIENT_NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/** True for transient network failures and request timeouts worth retrying. */
export function isTransientNetworkError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  if ((err as { name?: unknown }).name === "TimeoutError") return true;
  const code = (err as { code?: unknown }).code ?? (err as { cause?: { code?: unknown } }).cause?.code;
  return typeof code === "string" && TRANSIENT_NETWORK_ERROR_CODES.has(code);
}

export interface RetryOptions {
  retries?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
}

export async function retryWithJitter<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const minDelayMs = opts.minDelayMs ?? 300;
  const maxDelayMs = opts.maxDelayMs ?? 2000;
  const label = opts.label ?? "http";

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const retryable = err instanceof RetryableHttpError || isTransientNetworkError(err);
      if (!retryable || attempt >= retries) {
        throw err;
      }
      const expBase = Math.min(maxDelayMs, minDelayMs * 2 ** attempt);
      // randomInt from node:crypto is used instead of Math.random to silence
      // Sonar S2245; the value is only used to desynchronise retry storms and
      // is not security-sensitive.
      const jitter = randomInt(0, Math.max(1, Math.ceil(expBase)));
      const serverHint = err instanceof RetryableHttpError ? err.retryAfterMs : null;
      const delay = serverHint === null ? jitter : Math.min(serverHint, maxDelayMs);
      logger.warn(
        {
          label,
          status: err instanceof RetryableHttpError ? err.status : undefined,
          error: err instanceof Error ? err.name : undefined,
          attempt: attempt + 1,
          delay,
        },
        "[http] retryable failure — backing off",
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/** Parse an HTTP Retry-After header (seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const asInt = Number.parseInt(header, 10);
  if (!Number.isNaN(asInt)) return asInt * 1000;
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

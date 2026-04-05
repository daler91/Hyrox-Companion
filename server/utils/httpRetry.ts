import { logger } from "../logger";

/**
 * Bounded retry with jittered exponential backoff for outbound HTTP calls.
 *
 * Rationale (CODEBASE_AUDIT.md §5): Strava's external API has timeout
 * protection but no retry strategy for transient 5xx / 429 responses, so
 * a single provider hiccup surfaces as a user-visible failure even though
 * a retry a few hundred ms later would have succeeded.
 *
 * Only retries when `fn` throws a RetryableHttpError. Callers are expected
 * to classify responses themselves and throw the typed error for 429 / 5xx;
 * any other throw propagates immediately so 4xx client errors do not retry.
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
      if (!(err instanceof RetryableHttpError) || attempt >= retries) {
        throw err;
      }
      const expBase = Math.min(maxDelayMs, minDelayMs * 2 ** attempt);
      const jitter = Math.random() * expBase;
      const serverHint = err.retryAfterMs;
      const delay = serverHint === null ? jitter : Math.min(serverHint, maxDelayMs);
      logger.warn(
        { label, status: err.status, attempt: attempt + 1, delay },
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

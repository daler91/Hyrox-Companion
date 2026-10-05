import { parseRetryAfter, RetryableHttpError } from "../../utils/httpRetry";

/**
 * Small shared helpers for the external nutrition clients (USDA, OFF, Edamam).
 * Kept in one place so the numeric coercion, the oz→grams factor, the shared
 * GET-attempt policy and the per-request deadline can't drift between providers.
 */

/**
 * Coerce a provider's numeric field (often a string like "120.000") to a finite
 * number, or null when absent / non-numeric.
 */
export function num(value: unknown): number | null {
  let n: number;
  if (typeof value === "string") n = Number(value);
  else if (typeof value === "number") n = value;
  else n = Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Avoirdupois ounce → grams. One source of truth so an oz serving converts
 * identically across every client.
 */
export const OZ_TO_GRAMS = 28.349523125;

/**
 * One JSON GET attempt with the retry policy the key-authenticated clients
 * (Edamam) use: a fresh per-attempt timeout combined with any caller signal,
 * RetryableHttpError on 429/5xx (so `retryWithJitter` retries),
 * null on 404 (an unknown food/barcode — a normal "no result"), and a plain,
 * deliberately non-retryable Error on any other failure (401 bad key, 402/403
 * plan or quota, …) for the caller's catch to degrade on. The URL — which
 * carries the key — is never logged here.
 */
export async function providerGetJson<T>(
  url: string,
  timeoutMs: number,
  errorPrefix: string,
  signal?: AbortSignal,
): Promise<T | null> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: sig });
  if (res.status === 429 || res.status >= 500) {
    throw new RetryableHttpError(res.status, parseRetryAfter(res.headers.get("Retry-After")));
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${errorPrefix} with HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Overall budget for one request's live-provider calls (food search, food
 * detail). Each provider has its own 8 s per-attempt timeout and retries a
 * timeout as transient, and search waited on all three with no overall limit,
 * so one hanging provider ran past the client's 15 s timeout: the athlete got
 * "Request timed out" instead of the cache-only `apiDegraded` results, and an
 * un-enriched USDA food could not be opened to log. Kept well under 15 s so the
 * cache-only answer still arrives. D13 (CODEBASE_ANALYSIS_2026-10-03)
 */
export const PROVIDER_DEADLINE_MS = 9_000;

export class ProviderDeadlineError extends Error {
  constructor(ms: number) {
    super(`Food providers did not answer within ${ms}ms`);
    this.name = "ProviderDeadlineError";
  }
}

export interface ProviderDeadline {
  /** Aborts every provider call it is passed to once the deadline passes. */
  readonly signal: AbortSignal;
  /** Settles with `work`, or rejects with ProviderDeadlineError at the deadline. */
  within<T>(work: Promise<T>): Promise<T>;
  /** Stops the timer; call once the request no longer waits on a provider. */
  clear(): void;
}

/**
 * Start one deadline shared by every provider call of a request. The abort
 * carries no reason, so the calls see a plain AbortError, which
 * `retryWithJitter` never retries: a TimeoutError reason would read as
 * transient and let each provider retry past the deadline. `within` stops the
 * waiting even when a provider ignores its signal or sits in a retry backoff.
 */
export function startProviderDeadline(ms: number = PROVIDER_DEADLINE_MS): ProviderDeadline {
  const controller = new AbortController();
  const expired = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => {
        reject(new ProviderDeadlineError(ms));
      },
      { once: true },
    );
  });
  // Nothing may be waiting when the deadline passes; that rejection is
  // expected and must not surface as an unhandled one.
  expired.catch(() => undefined);
  // `ms` is a server constant, never request data, so the DevSkim
  // untrusted-delay review does not apply here.
  const timer = setTimeout(() => {
    // DevSkim: ignore DS172411
    controller.abort();
  }, ms);
  return {
    signal: controller.signal,
    within<T>(work: Promise<T>): Promise<T> {
      return Promise.race([work, expired]);
    },
    clear() {
      clearTimeout(timer);
    },
  };
}

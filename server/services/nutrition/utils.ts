import { parseRetryAfter, RetryableHttpError } from "../../utils/httpRetry";

/**
 * Small shared helpers for the external nutrition clients (USDA, OFF, FatSecret,
 * Spoonacular, Edamam). Kept in one place so the numeric coercion, the oz→grams
 * factor, and the shared GET-attempt policy can't drift between providers.
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
 * (Edamam, Spoonacular) share: a fresh per-attempt timeout combined with any
 * caller signal, RetryableHttpError on 429/5xx (so `retryWithJitter` retries),
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

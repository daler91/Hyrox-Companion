export const IMAGE_REPARSE_TIMEOUT_MS = 60_000;
export const PLAN_GENERATION_TIMEOUT_MS = 300_000;

/**
 * Keep image-based parsing request behavior aligned across workouts and plans.
 * Retries are intentionally handled by the caller/UI (not inside typedRequest).
 */
export const IMAGE_REPARSE_REQUEST_OPTIONS = Object.freeze({
  timeoutMs: IMAGE_REPARSE_TIMEOUT_MS,
});

/**
 * AI plan generation runs all week-chunks in parallel (each up to 120s
 * server-side budget), so the browser must wait at least that long plus
 * DB overhead. 5 minutes gives comfortable headroom over the worst-case
 * single-chunk retry scenario (~130s).
 */
export const PLAN_GENERATION_REQUEST_OPTIONS = Object.freeze({
  timeoutMs: PLAN_GENERATION_TIMEOUT_MS,
});

/**
 * Timeout-like errors are surfaced with the same user-facing fallback messaging.
 */
export const TIMEOUT_ERROR_TOKENS = Object.freeze([
  "request timed out",
  "timeouterror",
  "aborterror",
]);

export function isTimeoutLikeApiError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return TIMEOUT_ERROR_TOKENS.some((token) => message.includes(token));
}

export interface ReparseResponse {
  exercises: unknown[];
  saved: boolean;
  setCount?: number;
  rejectedCount?: number;
  rejectionReasons?: string[];
}

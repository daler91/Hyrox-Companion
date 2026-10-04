/**
 * Client timeout for a request whose handler waits on an AI call. The server
 * gives one AI request up to 120 s across its retries (AI_REQUEST_TIMEOUT_MS in
 * server/constants.ts), but these calls rode the 15 s default: a slow parse
 * showed "couldn't parse" while the server finished it, metered it and counted
 * it toward the parse limiter, so the athlete retried and paid twice. Sized
 * past the server budget so the server's own error, not a client abort, ends a
 * call that runs out of time. CL26 (CODEBASE_ANALYSIS_2026-10-03)
 */
export const AI_REQUEST_TIMEOUT_MS = 130_000;

export const AI_REQUEST_OPTIONS = Object.freeze({
  timeoutMs: AI_REQUEST_TIMEOUT_MS,
});

// An image parse is an AI parse: the same server budget applies
// (CL26, CODEBASE_ANALYSIS_2026-10-03).
export const IMAGE_REPARSE_TIMEOUT_MS = AI_REQUEST_TIMEOUT_MS;

/**
 * Keep image-based parsing request behavior aligned across workouts and plans.
 * Retries are intentionally handled by the caller/UI (not inside typedRequest).
 */
export const IMAGE_REPARSE_REQUEST_OPTIONS = Object.freeze({
  timeoutMs: IMAGE_REPARSE_TIMEOUT_MS,
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

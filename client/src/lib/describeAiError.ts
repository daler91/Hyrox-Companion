import { AiBudgetExceededError, RateLimitError } from "@/lib/queryClient";

export interface AiErrorCopy {
  /** Fills "You're <activity> too quickly…" in the rate-limit copy,
   * e.g. "requesting analysis" or "sending requests". */
  rateLimitActivity: string;
  /** Shown when the request was aborted or timed out. */
  slow: string;
  /** Shown for any failure the other cases don't recognize. */
  fallback: string;
}

/**
 * Friendly, user-facing message for an AI request failure (daily-budget cap,
 * rate limit, timeout, network). Shared by the AI surfaces so they describe
 * the same failures the same way, with per-surface copy where it differs.
 */
export function describeAiError(error: unknown, copy: AiErrorCopy): string {
  if (error instanceof AiBudgetExceededError) {
    return "You've reached your daily AI usage limit. Please try again later.";
  }
  if (error instanceof RateLimitError) {
    if (error.retryAfter && error.retryAfter > 0) {
      return `You're ${copy.rateLimitActivity} too quickly. Please wait about ${error.retryAfter} seconds and try again.`;
    }
    return `You're ${copy.rateLimitActivity} too quickly. Please wait a moment and try again.`;
  }
  if (
    (error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError")) ||
    (error instanceof Error &&
      (error.message.toLowerCase().includes("timed out") ||
        error.message.toLowerCase().includes("aborted")))
  ) {
    return copy.slow;
  }
  if (
    error instanceof Error &&
    (error.message.includes("network") || error.message.includes("fetch"))
  ) {
    return "Network error — please check your connection and try again.";
  }
  return copy.fallback;
}

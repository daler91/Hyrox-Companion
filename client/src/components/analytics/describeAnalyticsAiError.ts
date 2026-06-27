import { AiBudgetExceededError, RateLimitError } from "@/lib/queryClient";

/**
 * Friendly, user-facing message for an AI analytics generation failure
 * (daily-budget cap, rate limit, timeout, network). Shared by the AI analytics
 * surfaces so they describe the same failures the same way.
 */
export function describeAnalyticsAiError(error: unknown): string {
  if (error instanceof AiBudgetExceededError) {
    return "You've reached your daily AI usage limit. Please try again later.";
  }
  if (error instanceof RateLimitError) {
    if (error.retryAfter && error.retryAfter > 0) {
      return `You're requesting analysis too quickly. Please wait about ${error.retryAfter} seconds and try again.`;
    }
    return "You're requesting analysis too quickly. Please wait a moment and try again.";
  }
  if (
    (error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError")) ||
    (error instanceof Error &&
      (error.message.toLowerCase().includes("timed out") ||
        error.message.toLowerCase().includes("aborted")))
  ) {
    return "Generating the analysis is taking longer than expected. Please try again in a moment.";
  }
  if (
    error instanceof Error &&
    (error.message.includes("network") || error.message.includes("fetch"))
  ) {
    return "Network error — please check your connection and try again.";
  }
  return "Sorry, I couldn't generate the chart analysis right now. Please try again.";
}

import { describeAiError } from "@/lib/describeAiError";

/**
 * Friendly, user-facing message for an AI analytics generation failure
 * (daily-budget cap, rate limit, timeout, network). Shared by the AI analytics
 * surfaces so they describe the same failures the same way.
 */
export function describeAnalyticsAiError(error: unknown): string {
  return describeAiError(error, {
    rateLimitActivity: "requesting analysis",
    slow: "Generating the analysis is taking longer than expected. Please try again in a moment.",
    fallback: "Sorry, I couldn't generate the chart analysis right now. Please try again.",
  });
}

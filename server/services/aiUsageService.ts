import { logger } from "../logger";
import { storage } from "../storage";

// ---------------------------------------------------------------------------
// Per-model pricing (USD per 1 million tokens). Update when Google changes.
// ---------------------------------------------------------------------------
const MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  "gemini-2.5-flash-lite": { inputPerM: 0.075, outputPerM: 0.30 },
  "gemini-3.1-pro-preview": { inputPerM: 1.25, outputPerM: 10.0 },
  "gemini-embedding-001":   { inputPerM: 0.01, outputPerM: 0 },
};

// Fallback for unknown models — use the most expensive rate to be safe
const DEFAULT_PRICING = { inputPerM: 1.25, outputPerM: 10.0 };

/** Daily AI spend hard cap in cents. */
export const DAILY_LIMIT_CENTS = 200; // $2.00

/** Warning threshold in cents — client receives a header when exceeded. */
export const WARNING_THRESHOLD_CENTS = 150; // $1.50

/**
 * Estimate cost in cents from token counts and model name.
 */
export function estimateCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerM;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerM;
  // Convert dollars to cents
  return (inputCost + outputCost) * 100;
}

/**
 * Record AI usage after a Gemini call completes.
 */
export async function recordAiUsage(
  userId: string,
  model: string,
  feature: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  const costCents = estimateCostCents(model, inputTokens, outputTokens);
  try {
    await storage.aiUsage.insertUsageLog({
      userId,
      model,
      feature,
      inputTokens,
      outputTokens,
      estimatedCostCents: costCents,
    });
  } catch (err) {
    // Usage tracking should never block the user — log and continue
    logger.error({ err, userId, feature }, "Failed to record AI usage");
  }
}

export interface BudgetCheck {
  allowed: boolean;
  currentCostCents: number;
  limitCents: number;
  warning: boolean;
}

/**
 * Check whether a user is within their daily AI budget.
 */
export async function checkAiBudget(userId: string): Promise<BudgetCheck> {
  const currentCostCents = await storage.aiUsage.getDailyTotalCents(userId);
  return {
    allowed: currentCostCents < DAILY_LIMIT_CENTS,
    currentCostCents,
    limitCents: DAILY_LIMIT_CENTS,
    warning: currentCostCents >= WARNING_THRESHOLD_CENTS,
  };
}

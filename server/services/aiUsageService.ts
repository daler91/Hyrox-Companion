import { logger } from "../logger";
import { storage } from "../storage";

// ---------------------------------------------------------------------------
// Per-model pricing (USD per 1 million tokens). Update when Google changes.
// ---------------------------------------------------------------------------
const MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  "gemini-2.5-flash-lite": { inputPerM: 0.075, outputPerM: 0.3 },
  "gemini-2.5-flash": { inputPerM: 0.3, outputPerM: 2.5 },
  "gemini-3.1-pro-preview": { inputPerM: 1.25, outputPerM: 10 },
  "gemini-embedding-001":   { inputPerM: 0.01, outputPerM: 0 },
  "grok-4.3": { inputPerM: 1.25, outputPerM: 2.5 },
  "claude-sonnet-4-5": { inputPerM: 3, outputPerM: 15 },
  "claude-sonnet-4.5": { inputPerM: 3, outputPerM: 15 },
  "claude-4-sonnet": { inputPerM: 3, outputPerM: 15 },
};

// Fallback for unknown models — use the most expensive rate to be safe
const DEFAULT_PRICING = { inputPerM: 5, outputPerM: 25 };

// Falling back is safe for the budget cap but brutal for the athlete: against
// the fast model most calls use it bills 67x the input and 83x the output rate,
// so the $2 daily allowance is spent after roughly three cents of real usage
// and every AI feature goes dark for the day. Warn once per model so a missing
// entry is visible in logs instead of silent.
const warnedUnknownModels = new Set<string>();

/**
 * Resolve a model id to its pricing, exact match first and then longest
 * matching family prefix.
 *
 * Providers version their models by appending a suffix — `gemini-2.5-flash`
 * ships as `gemini-2.5-flash-002` — so without the prefix step a routine
 * version bump reads as "unknown model" and triggers the punitive fallback
 * above, with no code change and nothing to notice but a single log line.
 * Longest-prefix is load-bearing: `gemini-2.5-flash-lite-002` matches both
 * `gemini-2.5-flash` and `gemini-2.5-flash-lite`, and the lite rate is the
 * right one (the shorter match would bill it 4x over).
 */
export function resolveModelPricing(model: string): { inputPerM: number; outputPerM: number } | undefined {
  const exact = MODEL_PRICING[model];
  if (exact) return exact;
  let bestKey: string | undefined;
  for (const key of Object.keys(MODEL_PRICING)) {
    if (!model.startsWith(key)) continue;
    if (!bestKey || key.length > bestKey.length) bestKey = key;
  }
  return bestKey ? MODEL_PRICING[bestKey] : undefined;
}

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
  const pricing = resolveModelPricing(model);
  if (!pricing && !warnedUnknownModels.has(model)) {
    warnedUnknownModels.add(model);
    // `model` is a provider model identifier, not athlete data — and it is the
    // whole point of the line: without it nobody can tell which id fell through.
    // bearer:disable javascript_lang_logger_leak
    logger.warn(
      { model },
      "AI usage: no MODEL_PRICING entry or family prefix; applying conservative DEFAULT_PRICING",
    );
  }
  const effective = pricing ?? DEFAULT_PRICING;
  const inputCost = (inputTokens / 1_000_000) * effective.inputPerM;
  const outputCost = (outputTokens / 1_000_000) * effective.outputPerM;
  // Convert dollars to cents
  return (inputCost + outputCost) * 100;
}

/**
 * Record AI usage after a provider call completes.
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

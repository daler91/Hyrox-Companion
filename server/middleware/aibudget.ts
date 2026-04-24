import type { NextFunction, Request, Response } from "express";

import { env } from "../env";
import { logger } from "../logger";
import { checkAiBudget, DAILY_LIMIT_CENTS } from "../services/aiUsageService";
import { getUserId } from "../types";

/**
 * Express middleware that checks a user's rolling 24h AI spend.
 * - If over $2.00: returns 429 with AI_BUDGET_EXCEEDED code.
 * - If over $1.50: allows the request but sets X-AI-Budget-Warning header.
 */
export function aiBudgetCheck(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Operator-level kill switch. Runs before any DB work so flipping the
  // env flag immediately short-circuits AI traffic without touching
  // storage, the AI budget, or Gemini.
  if (env.AI_FEATURES_ENABLED === "false") {
    res.status(503).json({
      error: "AI features are temporarily disabled.",
      code: "AI_FEATURES_DISABLED",
    });
    return;
  }

  const run = async () => {
    try {
      const userId = getUserId(req);
      const budget = await checkAiBudget(userId);

      if (!budget.allowed) {
        res.status(429).json({
          error: "Daily AI usage limit reached. Your limit resets on a rolling 24-hour basis.",
          code: "AI_BUDGET_EXCEEDED",
          currentCostCents: Math.round(budget.currentCostCents),
          limitCents: DAILY_LIMIT_CENTS,
        });
        return;
      }

      if (budget.warning) {
        res.setHeader("X-AI-Budget-Warning", "true");
        res.setHeader(
          "X-AI-Budget-Remaining-Cents",
          String(Math.round(budget.limitCents - budget.currentCostCents)),
        );
      }

      next();
    } catch (err) {
      // If budget check fails, allow the request through — don't block users
      // due to a monitoring failure
      logger.error({ err }, "AI budget check failed — allowing request");
      next();
    }
  };
  void run();
}

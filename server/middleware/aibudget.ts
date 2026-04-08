import type { NextFunction, Request, Response } from "express";

import { logger } from "../logger";
import { checkAiBudget, DAILY_LIMIT_CENTS } from "../services/aiUsageService";
import { getUserId } from "../types";

/**
 * Express middleware that checks a user's rolling 24h AI spend.
 * - If over $2.00: returns 429 with AI_BUDGET_EXCEEDED code.
 * - If over $1.50: allows the request but sets X-AI-Budget-Warning header.
 */
export async function aiBudgetCheck(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
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
}

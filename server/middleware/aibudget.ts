import type { NextFunction, Request, Response } from "express";

import { env } from "../env";
import { logger } from "../logger";
import { checkAiBudget, DAILY_LIMIT_CENTS } from "../services/aiUsageService";
import { getUserId } from "../types";

/**
 * Express middleware that checks the rolling 24h AI spend before a request is
 * allowed to reach a provider.
 * - If the app-wide cap (AI_GLOBAL_DAILY_LIMIT_CENTS, when set) is reached:
 *   returns 503 with AI_GLOBAL_BUDGET_EXCEEDED.
 * - If this user is over $2.00: returns 429 with AI_BUDGET_EXCEEDED code.
 * - If this user is over $1.50: allows the request but sets the
 *   X-AI-Budget-Warning header.
 */
export function aiBudgetCheck(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Operator-level kill switch. Runs before any DB work so flipping the
  // env flag immediately short-circuits AI traffic without touching
  // storage, the AI budget, or provider clients.
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
        // The application-wide ceiling is a capacity/operator condition, not
        // something this athlete caused or can wait out on their own clock, so
        // it gets 503 + its own code rather than the personal-quota 429.
        if (budget.deniedBy === "global") {
          res.status(503).json({
            error: "AI features are temporarily unavailable due to high demand. Please try again later.",
            code: "AI_GLOBAL_BUDGET_EXCEEDED",
          });
          return;
        }
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
      logger.error({ err }, "AI budget check failed; blocking provider request");
      res.status(503).json({
        error: "AI budget enforcement is temporarily unavailable.",
        code: "AI_BUDGET_UNAVAILABLE",
      });
    }
  };
  void run();
}

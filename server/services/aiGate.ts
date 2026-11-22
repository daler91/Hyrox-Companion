/**
 * The AI gate for analyses that run outside the route middleware
 * (aiConsentCheck + aiBudgetCheck): the midnight recompute's coach insights,
 * nutrition insights and overview analysis, and the race predictor. It was
 * written four times, with three identical reason unions (R5,
 * REFACTORING_REVIEW 2026-09-23).
 *
 * Order: the global kill switch, then the athlete's consent, then their daily
 * budget; the first that blocks is the reason, and later checks are not run.
 * A budget lookup that fails throws, and each caller decides what that means:
 * the recompute job fails and is retried, the race predictor answers with its
 * deterministic prediction.
 */
import { env } from "../env";
import { storage } from "../storage";
import { checkAiBudget } from "./aiUsageService";

export type AiBlockedReason = "ai_disabled" | "ai_consent_off" | "ai_budget_exceeded";

type AiConsentHolder = { aiCoachEnabled?: boolean | null } | undefined;

/**
 * Resolve why AI may not run for this athlete, or null when it may.
 *
 * `loadUser` defaults to reading the user, and is only called once the kill
 * switch is off. A caller that already holds the user passes it in instead.
 */
export async function resolveAiBlocker(
  userId: string,
  loadUser: () => Promise<AiConsentHolder> = () => storage.users.getUser(userId),
): Promise<AiBlockedReason | null> {
  if (env.AI_FEATURES_ENABLED === "false") return "ai_disabled";

  const user = await loadUser();
  if (user?.aiCoachEnabled !== true) return "ai_consent_off";

  const budget = await checkAiBudget(userId);
  if (!budget.allowed) return "ai_budget_exceeded";

  return null;
}

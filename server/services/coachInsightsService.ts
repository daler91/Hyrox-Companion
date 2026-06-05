/**
 * Coach Insights generation — a single-shot AI analysis of the athlete's
 * progress against their stated goal. Extracted from the
 * POST /api/v1/coach-insights route handler so the route AND the midnight
 * recompute cron share one generation path.
 *
 * `generateCoachInsights` assumes gating already happened (the route runs the
 * aiConsentCheck + aiBudgetCheck middleware before calling it).
 * `generateCoachInsightsIfAllowed` does its OWN gating — mirroring
 * resolveAiBlocker in the race-prediction service — for callers like the cron
 * that run outside that middleware.
 */
import type { RagInfo } from "@shared/schema";
import type { Logger } from "pino";

import { env } from "../env";
import { chatWithCoach } from "../gemini/index";
import { logger as defaultLogger } from "../logger";
import { storage } from "../storage";
import { buildAIContext } from "./aiContextService";
import { checkAiBudget } from "./aiUsageService";
import { sanitizeRagInfo } from "./ragRetrieval";

export interface CoachInsightsResult {
  insights: string;
  ragInfo: RagInfo;
  generatedAt: string;
}

export type CoachInsightsBlockedReason = "ai_disabled" | "ai_consent_off" | "ai_budget_exceeded";

export type CoachInsightsGenerationOutcome =
  | { ok: true; result: CoachInsightsResult }
  | { ok: false; reason: CoachInsightsBlockedReason };

// Fixed analysis prompt. Reuses the chat surface (chatWithCoach) with a
// structured instruction rather than introducing a separate generation path.
export const COACH_INSIGHTS_PROMPT = [
  "Generate a Coach Insights analysis for the athlete using ONLY the training context provided in the system prompt.",
  "",
  "Focus the analysis on how the athlete is progressing toward their stated goal (see activePlan.goal). If no goal is set, evaluate progress against their weekly workout goal and overall consistency.",
  "",
  "Structure the response in clear Markdown with these sections:",
  "1. **Goal Progress** — How close is the athlete to their goal? Quantify where possible (race date, plan phase, weeks remaining, completion rate).",
  "2. **What's Working** — Strengths from recent workouts, RPE trends, progression flags, streaks.",
  "3. **Watch Outs** — Fatigue flags, station gaps, plateaus, undertraining signals, missed/skipped workouts.",
  "4. **Recommended Focus (Next 1–2 Weeks)** — 2–4 concrete, actionable priorities tied to the data.",
  "",
  "Be specific: cite numbers (RPE, completion %, days since station X, weekly volume vs goal) from the context. Keep tone warm but direct. Do not invent data that isn't in the context.",
].join("\n");

/**
 * Build the Coach Insights analysis. Gating is the caller's responsibility
 * (the route middleware, or generateCoachInsightsIfAllowed for the cron).
 */
export async function generateCoachInsights(
  userId: string,
  log: Logger = defaultLogger,
): Promise<CoachInsightsResult> {
  const startedAt = Date.now();
  const aiContext = await buildAIContext(userId, COACH_INSIGHTS_PROMPT, log);
  const insights = await chatWithCoach(
    COACH_INSIGHTS_PROMPT,
    [],
    aiContext.trainingContext,
    aiContext.coachingMaterials,
    aiContext.retrievedChunks,
    userId,
  );
  // userId is already bound on a child logger by the route; logging it again
  // trips Bearer's "leakage of information in logger message" rule. Stick to
  // per-call metadata only.
  log.info(
    { durationMs: Date.now() - startedAt, ragSource: aiContext.ragInfo?.source ?? "none" },
    "[ai] Coach insights generated",
  );
  return {
    insights,
    ragInfo: sanitizeRagInfo(aiContext.ragInfo),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Self-gating variant for the midnight cron. Returns the reason the analysis
 * was skipped (so the caller can preserve the previously stored result) rather
 * than throwing. Mirrors the gating order of resolveAiBlocker in the
 * race-prediction service.
 */
export async function generateCoachInsightsIfAllowed(
  userId: string,
  log: Logger = defaultLogger,
): Promise<CoachInsightsGenerationOutcome> {
  if (env.AI_FEATURES_ENABLED === "false") return { ok: false, reason: "ai_disabled" };

  const user = await storage.users.getUser(userId);
  if (user?.aiCoachEnabled !== true) return { ok: false, reason: "ai_consent_off" };

  try {
    const budget = await checkAiBudget(userId);
    if (!budget.allowed) return { ok: false, reason: "ai_budget_exceeded" };
  } catch (err) {
    // Budget lookup failure shouldn't hard-block the feature — log and allow,
    // matching the race-predictor's resolveAiBlocker behavior.
    log.warn({ err, userId }, "[coach-insights] AI budget check failed; allowing AI call");
  }

  return { ok: true, result: await generateCoachInsights(userId, log) };
}

/**
 * Coach Insights generation — a single-shot AI analysis of the athlete's
 * progress against their stated goal. Extracted from the
 * POST /api/v1/coach-insights route handler so the route AND the midnight
 * recompute cron share one generation path.
 *
 * `generateCoachInsights` assumes gating already happened (the route runs the
 * aiConsentCheck + aiBudgetCheck middleware before calling it).
 * `generateCoachInsightsIfAllowed` does its OWN gating (resolveAiBlocker in
 * aiGate) for callers like the cron that run outside that middleware.
 */
import type { RagInfo } from "@shared/schema";
import type { Logger } from "pino";

import { getTextAiConfig } from "../ai/providers/config";
import { chatWithCoach } from "../gemini/index";
import { logger as defaultLogger } from "../logger";
import { buildAIContext } from "./aiContextService";
import { type AiBlockedReason, resolveAiBlocker } from "./aiGate";
import { sanitizeRagInfo } from "./ragRetrieval";

export interface CoachInsightsResult {
  insights: string;
  ragInfo: RagInfo;
  generatedAt: string;
}

export type CoachInsightsGenerationOutcome =
  | { ok: true; result: CoachInsightsResult }
  | { ok: false; reason: AiBlockedReason };

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
    // A whole-progress analysis, not a chat turn: it keeps the global effort
    // rather than the chat cap.
    { reasoningEffort: getTextAiConfig().reasoningEffort },
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
 * than throwing. The gate (kill switch, consent, budget) is resolveAiBlocker.
 *
 * A budget lookup that fails is the exception: it throws, and no AI is spent
 * that the budget could not confirm. The recompute job then fails, releases
 * its daily claim and is retried by pg-boss (processRecomputeAnalyticsJob), as
 * the auto-coach job does. It used to log the failure and make the call.
 */
export async function generateCoachInsightsIfAllowed(
  userId: string,
  log: Logger = defaultLogger,
): Promise<CoachInsightsGenerationOutcome> {
  const blocker = await resolveAiBlocker(userId);
  if (blocker) return { ok: false, reason: blocker };

  return { ok: true, result: await generateCoachInsights(userId, log) };
}

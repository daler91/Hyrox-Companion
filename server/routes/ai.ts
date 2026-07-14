import { getAuth } from "@clerk/express";
import { chatRequestSchema, type InsertChatMessage,insertChatMessageSchema, type OverviewAnalysisResult, parseExercisesFromImageRequestSchema, parseExercisesRequestSchema } from "@shared/schema";
import { type Request as ExpressRequest, type Response,Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../clerkAuth";
import { chatWithCoach, parseExercisesFromImage, parseExercisesFromText, parseWorkoutStructureFromImage, parseWorkoutStructureFromText,streamChatWithCoach } from "../gemini/index";
import { reqLogger } from "../logger";
import { aiBudgetCheck } from "../middleware/aibudget";
import { aiConsentCheck } from "../middleware/aiConsent";
import { asyncHandler, rateLimiter, sendNotFound, validateBody, validateQuery } from "../routeUtils";
import { type AIContext, buildAIContext, type ChatInput } from "../services/aiContextService";
import { applyTimelineAiSuggestion, generateTimelineAiSuggestions } from "../services/aiSuggestionService";
import { computeStale, getLatestWorkoutDate, regenerateAndStoreCoachInsights, regenerateAndStoreOverviewAnalysis } from "../services/analyticsPersistence";
import { classifyPlanEditIntent, hasPlanEditKeywords, isPlanEditIntent } from "../services/chatIntentService";
import type { CoachInsightsResult } from "../services/coachInsightsService";
import { applyPlanAdjustmentProposal, createPlanAdjustmentProposal } from "../services/planAdjustmentService";
import { sanitizeRagInfo } from "../services/ragRetrieval";
import { registerSseStream } from "../sseRegistry";
import { storage } from "../storage";
import { getUserId } from "../types";
import { getChatHistoryUseCase } from "../usecases/ai/chatHistory.usecase";
import { protectedDelete, protectedPost } from "./_helpers/protectedRouteBuilder";
import { serializePlanProposal } from "./planProposals";

const router = Router();

const applyTimelineSuggestionSchema = z.object({
  workoutId: z.string().min(1),
  targetField: z.enum(["notes", "mainWorkout", "accessory"]),
  action: z.enum(["replace", "append"]),
  recommendation: z.string().min(1).max(10_000),
  rationale: z.string().max(2_000).nullable().optional(),
  aiSource: z.enum(["rag", "legacy", "none"]).nullable().optional(),
});

async function loadParseUserContext(req: ExpressRequest) {
  const userId = getUserId(req);
  const [user, userCustomExercises] = await Promise.all([
    storage.users.getUser(userId),
    storage.users.getCustomExercises(userId),
  ]);

  return {
    userId,
    unitPreferences: { weightUnit: user?.weightUnit || "kg", distanceUnit: user?.distanceUnit || "km" },
    customExerciseNames: userCustomExercises.map((exercise) => exercise.name),
  };
}

protectedPost(router, "/api/v1/parse-exercises", { limiter: rateLimiter("parse", 5), middleware: [aiConsentCheck, aiBudgetCheck, validateBody(parseExercisesRequestSchema)] }, async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof parseExercisesRequestSchema>>, res: Response) => {
    const { text } = req.body;
    const { userId, unitPreferences, customExerciseNames } = await loadParseUserContext(req);
    const exercises = await parseExercisesFromText(text.trim(), unitPreferences, customExerciseNames, userId);
    res.json(exercises);
  });

protectedPost(router, "/api/v1/parse-workout-structure", { limiter: rateLimiter("parse", 5), middleware: [aiConsentCheck, aiBudgetCheck, validateBody(parseExercisesRequestSchema)] }, async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof parseExercisesRequestSchema>>, res: Response) => {
    const { text } = req.body;
    const { userId, unitPreferences, customExerciseNames } = await loadParseUserContext(req);
    const parsed = await parseWorkoutStructureFromText(text.trim(), unitPreferences, customExerciseNames, userId);
    res.json(parsed);
  });

// Photo-parse sibling. Shares the "parse" rate bucket and AI-budget gates
// with the text route so total parse-family spend stays capped per user.
// Body size is enforced by a route-scoped express.json({ limit: "10mb" })
// mounted in server/index.ts BEFORE the global 100kb parser.
protectedPost(router, "/api/v1/parse-exercises-from-image", { limiter: rateLimiter("parse", 5), middleware: [aiConsentCheck, aiBudgetCheck, validateBody(parseExercisesFromImageRequestSchema)] }, async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof parseExercisesFromImageRequestSchema>>, res: Response) => {
    const { imageBase64, mimeType } = req.body;
    const { userId, unitPreferences, customExerciseNames } = await loadParseUserContext(req);
    const exercises = await parseExercisesFromImage({
      imageBase64,
      mimeType,
      ...unitPreferences,
      customExerciseNames,
      userId,
    });
    res.json(exercises);
  });

protectedPost(router, "/api/v1/parse-workout-structure-from-image", { limiter: rateLimiter("parse", 5), middleware: [aiConsentCheck, aiBudgetCheck, validateBody(parseExercisesFromImageRequestSchema)] }, async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof parseExercisesFromImageRequestSchema>>, res: Response) => {
    const { imageBase64, mimeType } = req.body;
    const { userId, unitPreferences, customExerciseNames } = await loadParseUserContext(req);
    const parsed = await parseWorkoutStructureFromImage({
      imageBase64,
      mimeType,
      ...unitPreferences,
      customExerciseNames,
      userId,
    });
    res.json(parsed);
  });

// validateBody(chatRequestSchema) guarantees req.body conforms, so the
// handler can read it directly without a second safeParse pass.
async function prepareChatContext(
  req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof chatRequestSchema>>,
): Promise<{ input: ChatInput; aiContext: AIContext }> {
  const { message, history } = req.body;
  const userId = getUserId(req);
  const aiContext = await buildAIContext(userId, message, reqLogger(req));
  return { input: { message, history: history || [] }, aiContext };
}

protectedPost(router, "/api/v1/chat", { limiter: rateLimiter("chat", 10), middleware: [aiConsentCheck, aiBudgetCheck, validateBody(chatRequestSchema)] }, async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof chatRequestSchema>>, res: Response) => {
    const userId = getUserId(req);
    const { input, aiContext } = await prepareChatContext(req);
    const response = await chatWithCoach(input.message, input.history, aiContext.trainingContext, aiContext.coachingMaterials, aiContext.retrievedChunks, userId);
    res.json({ response, ragInfo: sanitizeRagInfo(aiContext.ragInfo) });
  });

// Belt-and-suspenders ceiling for SSE stream duration. Both caps fire
// via controller.abort() so the existing drain/finally path runs cleanly:
//   - SSE_MAX_DURATION_MS: hard wall-clock cap, applies even when the JWT
//     has hours of headroom (prevents runaway AI generation on a
//     pathologically slow prompt).
//   - JWT `exp` minus a small margin: aborts before the Clerk session
//     actually expires so responses can't persist against a
//     now-invalid session (Warning-12).
const SSE_MAX_DURATION_MS = 5 * 60 * 1000;

/**
 * Grace period after a deadline-induced controller.abort() before we
 * forcibly destroy the underlying socket (W4). controller.abort() stops
 * the generator and res.end() tries to flush a final SSE event, but if
 * the client is hung and not draining its read buffer, the TCP FIN may
 * never be ACK'd and the file descriptor can linger up to the OS
 * keepalive timeout (~2 hours on Linux defaults). 2 seconds is enough
 * for a healthy client to ACK the FIN; anything still pending after
 * that gets destroyed.
 */
const SSE_FORCE_CLOSE_GRACE_MS = 2_000;
const SSE_EXPIRY_MARGIN_MS = 5_000;

export type SseDeadlineReason = "auth-expired" | "timeout";

// Exported for unit tests — no external consumer should rely on this.
export function computeSseDeadline(req: ExpressRequest): { deadlineMs: number; reason: SseDeadlineReason } {
  const hardCap = Date.now() + SSE_MAX_DURATION_MS;
  try {
    const auth = getAuth(req);
    const expSec = auth?.sessionClaims?.exp;
    if (typeof expSec === "number" && expSec > 0) {
      // The JWT floor overrides the hard cap even when it's already in
      // the past. A token that expires inside the 5s margin (or was
      // mid-stream when the user logged out) should abort the stream
      // immediately, not fall back to a 5-minute cap — otherwise the
      // stated "no persistence under an invalid session" invariant
      // silently breaks (Codex review of #877). Clamp to `now` so
      // setTimeout fires on the next tick.
      const expMs = expSec * 1000 - SSE_EXPIRY_MARGIN_MS;
      if (expMs < hardCap) {
        return { deadlineMs: Math.max(expMs, Date.now()), reason: "auth-expired" };
      }
    }
  } catch {
    // Dev bypass / test harness won't expose sessionClaims — fall back
    // to the hard cap, which is always safe.
  }
  return { deadlineMs: hardCap, reason: "timeout" };
}

// Backwards-compat shim for tests still asserting on the old number-returning
// signature. Internal call sites use computeSseDeadline().
export function computeSseDeadlineMs(req: ExpressRequest): number {
  return computeSseDeadline(req).deadlineMs;
}

protectedPost(router, "/api/v1/chat/stream", { limiter: rateLimiter("chat", 10), middleware: [aiConsentCheck, aiBudgetCheck, validateBody(chatRequestSchema)] }, async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof chatRequestSchema>>, res: Response) => {
    const userId = getUserId(req);
    const { input, aiContext } = await prepareChatContext(req);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Bridge Express req-close -> AbortController so upstream provider
    // generation is torn down promptly on client disconnect
    // (CODEBASE_AUDIT.md §3). The same controller is registered with
    // the SSE registry so graceful shutdown can abort every in-flight
    // stream and let `httpServer.close()` complete without waiting on
    // long-lived connections.
    const controller = new AbortController();
    const unregister = registerSseStream(controller);
    req.on("close", () => controller.abort());

    // Track the abort reason separately so we can tell the client whether
    // their stream was killed because the Clerk session expired (which they
    // can recover from by re-authing) vs a hard-cap timeout vs a generic
    // client/shutdown abort. Wrapped in an object so TypeScript control-flow
    // doesn't narrow it to its initial literal value (the setTimeout
    // reassignment is async).
    const abortState: { reason: "auth-expired" | "timeout" | "generic" } = { reason: "generic" };

    // Auto-abort when the stream exceeds its deadline (hard cap OR Clerk
    // session expiry, whichever comes first). The deadline reason
    // distinguishes which one fired so we report the correct cause to
    // the client — only auth-expired is recoverable by re-authing. unref()
    // so the timer doesn't block process exit on an otherwise-idle server.
    const { deadlineMs, reason: deadlineReason } = computeSseDeadline(req);
    let forceCloseTimer: ReturnType<typeof setTimeout> | null = null;
    const deadlineTimer = setTimeout(() => {
      abortState.reason = deadlineReason;
      controller.abort();
      // After a short grace period, forcibly destroy the underlying socket
      // if the response is still pending — a client that's hung past the
      // hard cap would otherwise pin the TCP connection (and FD) until OS
      // keepalive eventually reaps it (W4). Only fires on deadline-induced
      // aborts; normal completion clears this timer in the finally block.
      forceCloseTimer = setTimeout(() => {
        forceCloseTimer = null;
        if (!res.writableEnded) {
          reqLogger(req).warn(
            { context: "sse", reason: abortState.reason },
            "SSE deadline grace expired with response still open — destroying socket",
          );
          res.socket?.destroy();
        }
      }, SSE_FORCE_CLOSE_GRACE_MS);
      forceCloseTimer.unref();
    }, Math.max(0, deadlineMs - Date.now()));
    deadlineTimer.unref();

    // Honour slow-client backpressure. A slow client drains the Node write
    // buffer slowly — without waiting on `drain` we keep res.write()-ing
    // chunks that balloon the process's memory. awaitDrain resolves once
    // the socket is ready for more, or immediately when the stream is
    // aborted so we don't leak a listener.
    const awaitDrain = () =>
      new Promise<void>((resolve) => {
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          res.off("drain", onDrain);
          controller.signal.removeEventListener("abort", onAbort);
          resolve();
        };
        const onDrain = () => settle();
        const onAbort = () => settle();
        res.once("drain", onDrain);
        controller.signal.addEventListener("abort", onAbort, { once: true });
        // Re-check after registration: if abort fired between the caller's
        // pre-check and our addEventListener, the listener will never be
        // invoked and the promise would hang forever.
        if (controller.signal.aborted) settle();
      });

    const safeWrite = async (payload: string) => {
      const ok = res.write(payload);
      if (!ok && !controller.signal.aborted) {
        await awaitDrain();
      }
    };

    try {
      await safeWrite(`data: ${JSON.stringify({ ragInfo: sanitizeRagInfo(aiContext.ragInfo) })}\n\n`);

      // Conversational plan editing: when the message looks like a plan-change
      // request (cheap keyword gate, then a fast-model classifier), generate a
      // structured multi-day proposal instead of a prose reply. Any failure in
      // this branch falls through to the normal streaming chat — the feature
      // must never break plain conversation.
      if (req.body.planEditing !== false && hasPlanEditKeywords(input.message)) {
        try {
          const intent = await classifyPlanEditIntent(input.message, input.history, userId);
          if (isPlanEditIntent(intent) && !controller.signal.aborted) {
            // Lets the client swap "Thinking..." for a plan-review status.
            await safeWrite(`data: ${JSON.stringify({ planProposalPending: true })}\n\n`);
            const result = await createPlanAdjustmentProposal(
              { userId, message: input.message, history: input.history, aiContext, focusPlanDayId: req.body.focusPlanDayId },
              reqLogger(req),
            );
            if (result.kind === "proposal" || result.kind === "chat_fallback") {
              let proposal = result.kind === "proposal" ? result.proposal : null;
              if (proposal) {
                const user = await storage.users.getUser(userId);
                if (user?.coachAutoApplyPlanChanges) {
                  const applyResult = await applyPlanAdjustmentProposal(userId, proposal.id, reqLogger(req));
                  if (applyResult?.applied) {
                    proposal = { ...proposal, status: "applied" };
                  }
                  // On auto-apply failure the proposal stays pending (or was
                  // invalidated); the card renders with its live status and
                  // the athlete can retry or dismiss manually.
                }
              }
              const summaryText = result.kind === "proposal" ? result.proposal.summaryMessage : result.text;
              if (!controller.signal.aborted) {
                await safeWrite(`data: ${JSON.stringify({ text: summaryText })}\n\n`);
                if (proposal) {
                  await safeWrite(`data: ${JSON.stringify({ planProposal: serializePlanProposal(proposal) })}\n\n`);
                }
                res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
              }
              res.end();
              return;
            }
            // generation_failed → fall through to the normal chat stream.
          }
        } catch (planEditError) {
          if (controller.signal.aborted) {
            res.end();
            return;
          }
          reqLogger(req).warn({ err: planEditError }, "[plan-adjustment] Chat branch failed; falling back to normal chat");
        }
      }

      const stream = streamChatWithCoach(input.message, input.history, aiContext.trainingContext, aiContext.coachingMaterials, aiContext.retrievedChunks, controller.signal, userId);

      for await (const chunk of stream) {
        if (controller.signal.aborted) {
          reqLogger(req).info("Client disconnected mid-stream, stopping AI generation");
          break;
        }
        await safeWrite(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }

      if (!controller.signal.aborted) {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      } else if (abortState.reason === "auth-expired") {
        // Best-effort — the underlying socket may already be half-closed
        // by the time we try. The client SSE reader treats a visible
        // error payload differently from a silent close, so we prefer
        // a named event over letting the connection die in silence.
        res.write(`data: ${JSON.stringify({ error: "auth-expired", reason: "Your session expired — please sign in again." })}\n\n`);
      } else if (abortState.reason === "timeout") {
        res.write(`data: ${JSON.stringify({ error: "timeout", reason: "The response took too long and was stopped." })}\n\n`);
      }
      res.end();
    } catch (streamError) {
      if (controller.signal.aborted) return;
      reqLogger(req).error({ err: streamError }, "Stream error:");
      res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`);
      res.end();
    } finally {
      clearTimeout(deadlineTimer);
      if (forceCloseTimer) clearTimeout(forceCloseTimer);
      unregister();
    }
  });

// Cursor-paginated to cap memory/bandwidth growth as chat history accumulates.
// Response body stays a plain ChatMessage[] for backward compatibility; the
// cursor for older messages is surfaced in two sibling response headers
// (`X-Next-Cursor` = timestamp, `X-Next-Cursor-Id` = row id). Both must be
// echoed back on the next request to avoid dropping rows that share a
// millisecond — see `storage/users.ts` comment for details.
const chatHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    before: z.string().datetime({ offset: true }).optional(),
    beforeId: z.string().min(1).max(255).optional(),
  })
  .refine(
    (q) => (q.before == null) === (q.beforeId == null),
    { message: "before and beforeId must be provided together" },
  );

router.get("/api/v1/chat/history", isAuthenticated, validateQuery(chatHistoryQuerySchema), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const { limit, before, beforeId } = req.query as z.infer<typeof chatHistoryQuerySchema>;
    const { messages, nextCursor } = await getChatHistoryUseCase(storage.users, { userId, limit, before, beforeId });
    if (nextCursor) {
      res.setHeader("X-Next-Cursor", nextCursor.timestamp);
      res.setHeader("X-Next-Cursor-Id", nextCursor.id);
    }
    res.json(messages);
  }));

protectedPost(router, "/api/v1/chat/message", { limiter: rateLimiter("chatMessage", 20), middleware: [validateBody(insertChatMessageSchema)] }, async (req: ExpressRequest<Record<string, never>, unknown, InsertChatMessage>, res: Response) => {
    const userId = getUserId(req);
    const { role, content } = req.body;

    const message = await storage.users.saveChatMessage({ userId, role, content });
    res.json(message);
  });

protectedDelete(router, "/api/v1/chat/history", { limiter: rateLimiter("chatHistoryDelete", 5) }, async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    await storage.users.clearChatHistory(userId);
    res.json({ success: true });
  });

// Coach Insights — single-shot AI analysis of the user's progress against
// their stated goal. The fixed analysis prompt and generation live in
// services/coachInsightsService so the route and the midnight recompute cron
// share one path.
//
// GET returns the LAST stored result instantly (no AI spend) so the tab paints
// the previous analysis on open instead of a blank state; `stale` flags that a
// workout was logged after it was generated. POST regenerates (gated by the AI
// consent/budget middleware) and persists the fresh result.
router.get("/api/v1/coach-insights", isAuthenticated, rateLimiter("analytics", 60), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const row = await storage.analyticsResults.get(userId, "coach_insights");
    if (!row) {
      res.json({ insights: null });
      return;
    }
    const latestWorkoutDate = await getLatestWorkoutDate(userId);
    const payload = row.payload as CoachInsightsResult;
    res.json({
      ...payload,
      generatedAt: row.generatedAt.toISOString(),
      stale: computeStale(row, latestWorkoutDate),
    });
  }));

protectedPost(router, "/api/v1/coach-insights", { limiter: rateLimiter("suggestions", 3), middleware: [aiConsentCheck, aiBudgetCheck] }, async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const result = await regenerateAndStoreCoachInsights(userId, reqLogger(req));
    // Freshly generated against the current latest workout, so never stale.
    res.json({ ...result, stale: false });
  });

// Overview AI chart analysis — one AI call produces a short "what this means for
// you" reading per Overview-tab chart, keyed so each chart card renders its own
// explanation inline. Same stored-first shape as Coach Insights: GET paints the
// last stored result instantly (no AI spend) with a `stale` flag; POST
// regenerates (gated by the AI consent/budget middleware) and persists.
router.get("/api/v1/overview-analysis", isAuthenticated, rateLimiter("analytics", 60), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const row = await storage.analyticsResults.get(userId, "overview_analysis");
    if (!row) {
      res.json({ sections: null });
      return;
    }
    const latestWorkoutDate = await getLatestWorkoutDate(userId);
    const payload = row.payload as OverviewAnalysisResult;
    res.json({
      ...payload,
      generatedAt: row.generatedAt.toISOString(),
      stale: computeStale(row, latestWorkoutDate),
    });
  }));

protectedPost(router, "/api/v1/overview-analysis", { limiter: rateLimiter("suggestions", 3), middleware: [aiConsentCheck, aiBudgetCheck] }, async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const result = await regenerateAndStoreOverviewAnalysis(userId, reqLogger(req));
    // Freshly generated against the current latest workout, so never stale.
    res.json({ ...result, stale: false });
  });

protectedPost(router, "/api/v1/timeline/ai-suggestions", { limiter: rateLimiter("suggestions", 3), middleware: [aiConsentCheck, aiBudgetCheck] }, async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const log = reqLogger(req);
    const startedAt = Date.now();
    try {
      const result = await generateTimelineAiSuggestions(userId, log);
      log.info(
        {
          userId,
          durationMs: Date.now() - startedAt,
          suggestionCount: result.suggestions.length,
          ragSource: result.ragInfo?.source ?? "none",
        },
        "[ai] Timeline suggestions completed",
      );
      res.json(result);
      return;
    } catch (err) {
      log.error(
        { err, userId, durationMs: Date.now() - startedAt },
        "[ai] Timeline suggestions failed",
      );
      throw err;
    }
  });


router.get("/api/v1/timeline/ai-suggestions/debug/:workoutId", isAuthenticated, asyncHandler(async (req: ExpressRequest<{workoutId: string}>, res: Response) => {
    const userId = getUserId(req);
    const day = await storage.plans.getPlanDay(req.params.workoutId, userId);
    if (!day) {
      sendNotFound(res, "Plan day not found");
      return;
    }
    res.json({
      workoutId: day.id,
      focus: day.focus,
      aiSource: day.aiSource,
      aiRationale: day.aiRationale,
      aiNoteUpdatedAt: day.aiNoteUpdatedAt,
      trace: day.aiInputsUsed?.recommendationTrace ?? null,
      debugSummary: day.aiInputsUsed?.recommendationTrace
        ? `Generated for style ${day.aiInputsUsed.recommendationTrace.trainingStyleId} in phase ${day.aiInputsUsed.recommendationTrace.phase} using ${day.aiInputsUsed.recommendationTrace.strategyRuleVersion} and ${day.aiInputsUsed.recommendationTrace.promptBundleVersion}.`
        : null,
    });
  }));
protectedPost(router, "/api/v1/timeline/ai-suggestions/apply", { limiter: rateLimiter("suggestionApply", 10), middleware: [aiConsentCheck, validateBody(applyTimelineSuggestionSchema)] }, async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof applyTimelineSuggestionSchema>>, res: Response) => {
    const userId = getUserId(req);
    const result = await applyTimelineAiSuggestion(userId, req.body, reqLogger(req));
    if (!result) {
      sendNotFound(res, "Plan day not found");
      return;
    }
    res.json(result);
  });

export default router;

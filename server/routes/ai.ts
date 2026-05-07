import { getAuth } from "@clerk/express";
import { chatRequestSchema, type InsertChatMessage,insertChatMessageSchema, parseExercisesFromImageRequestSchema, parseExercisesRequestSchema } from "@shared/schema";
import { type Request as ExpressRequest, type Response,Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../clerkAuth";
import { chatWithCoach, parseExercisesFromImage, parseExercisesFromText,streamChatWithCoach } from "../gemini/index";
import { reqLogger } from "../logger";
import { aiBudgetCheck } from "../middleware/aibudget";
import { aiConsentCheck } from "../middleware/aiConsent";
import { asyncHandler, rateLimiter, sendNotFound, validateBody, validateQuery } from "../routeUtils";
import { type AIContext, buildAIContext, type ChatInput } from "../services/aiContextService";
import { applyTimelineAiSuggestion, generateTimelineAiSuggestions } from "../services/aiSuggestionService";
import { sanitizeRagInfo } from "../services/ragRetrieval";
import { registerSseStream } from "../sseRegistry";
import { storage } from "../storage";
import { getUserId } from "../types";
import { getChatHistoryUseCase } from "../usecases/ai/chatHistory.usecase";
import { protectedDelete, protectedPost } from "./_helpers/protectedRouteBuilder";

const router = Router();

const applyTimelineSuggestionSchema = z.object({
  workoutId: z.string().min(1),
  targetField: z.enum(["notes", "mainWorkout", "accessory"]),
  action: z.enum(["replace", "append"]),
  recommendation: z.string().min(1).max(10_000),
  rationale: z.string().max(2_000).nullable().optional(),
  aiSource: z.enum(["rag", "legacy", "none"]).nullable().optional(),
});

protectedPost(router, "/api/v1/parse-exercises", { limiter: rateLimiter("parse", 5), middleware: [aiConsentCheck, aiBudgetCheck, validateBody(parseExercisesRequestSchema)] }, async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof parseExercisesRequestSchema>>, res: Response) => {
    const { text } = req.body;
    const userId = getUserId(req);
    // ⚡ Perf: Parallelize independent DB queries to cut latency from
    // 2 sequential round trips down to 1 concurrent round trip.
    const [user, userCustomExercises] = await Promise.all([
      storage.users.getUser(userId),
      storage.users.getCustomExercises(userId),
    ]);
    const weightUnit = user?.weightUnit || "kg";
    const customNames = userCustomExercises.map(e => e.name);
    const exercises = await parseExercisesFromText(text.trim(), weightUnit, customNames, userId, {
      correlationId: req.id,
      workoutId: undefined,
      userId,
    });
    res.json(exercises);
  });

// Photo-parse sibling. Shares the "parse" rate bucket and AI-budget gates
// with the text route so total parse-family spend stays capped per user.
// Body size is enforced by a route-scoped express.json({ limit: "10mb" })
// mounted in server/index.ts BEFORE the global 100kb parser.
protectedPost(router, "/api/v1/parse-exercises-from-image", { limiter: rateLimiter("parse", 5), middleware: [aiConsentCheck, aiBudgetCheck, validateBody(parseExercisesFromImageRequestSchema)] }, async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof parseExercisesFromImageRequestSchema>>, res: Response) => {
    const { imageBase64, mimeType } = req.body;
    const userId = getUserId(req);
    const [user, userCustomExercises] = await Promise.all([
      storage.users.getUser(userId),
      storage.users.getCustomExercises(userId),
    ]);
    const weightUnit = user?.weightUnit || "kg";
    const customNames = userCustomExercises.map(e => e.name);
    const exercises = await parseExercisesFromImage({
      imageBase64,
      mimeType,
      weightUnit,
      customExerciseNames: customNames,
      userId,
      logContext: { correlationId: req.id, workoutId: undefined, userId },
    });
    res.json(exercises);
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
//     has hours of headroom (prevents runaway Gemini generation on a
//     pathologically slow prompt).
//   - JWT `exp` minus a small margin: aborts before the Clerk session
//     actually expires so responses can't persist against a
//     now-invalid session (Warning-12).
const SSE_MAX_DURATION_MS = 5 * 60 * 1000;
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

    // Bridge Express req-close → AbortController so upstream Gemini
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
    const deadlineTimer = setTimeout(() => {
      abortState.reason = deadlineReason;
      controller.abort();
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
// their stated goal. Reuses the chat surface (chatWithCoach) with a fixed
// analysis prompt rather than introducing a new generation path. Rate-limited
// like suggestions because it builds the full training + RAG context.
const COACH_INSIGHTS_PROMPT = [
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

protectedPost(router, "/api/v1/coach-insights", { limiter: rateLimiter("suggestions", 3), middleware: [aiConsentCheck, aiBudgetCheck] }, async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const log = reqLogger(req);
    const startedAt = Date.now();
    const aiContext = await buildAIContext(userId, COACH_INSIGHTS_PROMPT, log);
    const response = await chatWithCoach(
      COACH_INSIGHTS_PROMPT,
      [],
      aiContext.trainingContext,
      aiContext.coachingMaterials,
      aiContext.retrievedChunks,
      userId,
    );
    // userId is already bound on the child logger via reqLogger; logging
    // it again here trips Bearer's "leakage of information in logger
    // message" rule. Stick to per-call metadata only.
    log.info(
      { durationMs: Date.now() - startedAt, ragSource: aiContext.ragInfo?.source ?? "none" },
      "[ai] Coach insights generated",
    );
    res.json({ insights: response, ragInfo: sanitizeRagInfo(aiContext.ragInfo), generatedAt: new Date().toISOString() });
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

import { getAuth } from "@clerk/express";
import { chatRequestSchema, type InsertChatMessage,insertChatMessageSchema, parseExercisesFromImageRequestSchema, parseExercisesRequestSchema } from "@shared/schema";
import { type Request as ExpressRequest, type Response,Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../clerkAuth";
import { chatWithCoach, parseExercisesFromImage, parseExercisesFromText,streamChatWithCoach } from "../gemini/index";
import { reqLogger } from "../logger";
import { aiBudgetCheck } from "../middleware/aibudget";
import { aiConsentCheck } from "../middleware/aiConsent";
import { protectedMutationGuards } from "../routeGuards";
import { asyncHandler, rateLimiter, validateBody } from "../routeUtils";
import { type AIContext, buildAIContext, type ChatInput } from "../services/aiContextService";
import { generateTimelineAiSuggestions } from "../services/aiSuggestionService";
import { sanitizeRagInfo } from "../services/ragRetrieval";
import { registerSseStream } from "../sseRegistry";
import { storage } from "../storage";
import { getUserId } from "../types";

const router = Router();

router.post("/api/v1/parse-exercises", ...protectedMutationGuards, rateLimiter("parse", 5), aiConsentCheck, aiBudgetCheck, validateBody(parseExercisesRequestSchema), asyncHandler(async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof parseExercisesRequestSchema>>, res: Response) => {
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
    const exercises = await parseExercisesFromText(text.trim(), weightUnit, customNames, userId);
    res.json(exercises);
  }));

// Photo-parse sibling. Shares the "parse" rate bucket and AI-budget gates
// with the text route so total parse-family spend stays capped per user.
// Body size is enforced by a route-scoped express.json({ limit: "10mb" })
// mounted in server/index.ts BEFORE the global 100kb parser.
router.post("/api/v1/parse-exercises-from-image", ...protectedMutationGuards, rateLimiter("parse", 5), aiConsentCheck, aiBudgetCheck, validateBody(parseExercisesFromImageRequestSchema), asyncHandler(async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof parseExercisesFromImageRequestSchema>>, res: Response) => {
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
    });
    res.json(exercises);
  }));

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

router.post("/api/v1/chat", ...protectedMutationGuards, rateLimiter("chat", 10), aiConsentCheck, aiBudgetCheck, validateBody(chatRequestSchema), asyncHandler(async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof chatRequestSchema>>, res: Response) => {
    const userId = getUserId(req);
    const { input, aiContext } = await prepareChatContext(req);
    const response = await chatWithCoach(input.message, input.history, aiContext.trainingContext, aiContext.coachingMaterials, aiContext.retrievedChunks, userId);
    res.json({ response, ragInfo: sanitizeRagInfo(aiContext.ragInfo) });
  }));

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

router.post("/api/v1/chat/stream", ...protectedMutationGuards, rateLimiter("chat", 10), aiConsentCheck, aiBudgetCheck, validateBody(chatRequestSchema), asyncHandler(async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof chatRequestSchema>>, res: Response) => {
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
  }));

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

router.get("/api/v1/chat/history", isAuthenticated, asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const parsed = chatHistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid pagination params", code: "VALIDATION_ERROR" });
    }
    const { limit, before, beforeId } = parsed.data;
    const messages = await storage.users.getChatMessages(userId, {
      limit,
      beforeTimestamp: before ? new Date(before) : undefined,
      beforeId,
    });
    const oldest = messages[0];
    if (oldest?.timestamp) {
      res.setHeader("X-Next-Cursor", oldest.timestamp.toISOString());
      res.setHeader("X-Next-Cursor-Id", oldest.id);
    }
    res.json(messages);
  }));

router.post("/api/v1/chat/message", ...protectedMutationGuards, rateLimiter("chatMessage", 20), validateBody(insertChatMessageSchema), asyncHandler(async (req: ExpressRequest<Record<string, never>, unknown, InsertChatMessage>, res: Response) => {
    const userId = getUserId(req);
    const { role, content } = req.body;

    const message = await storage.users.saveChatMessage({ userId, role, content });
    res.json(message);
  }));

router.delete("/api/v1/chat/history", ...protectedMutationGuards, rateLimiter("chatHistoryDelete", 5), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    await storage.users.clearChatHistory(userId);
    res.json({ success: true });
  }));

router.post("/api/v1/timeline/ai-suggestions", ...protectedMutationGuards, rateLimiter("suggestions", 3), aiConsentCheck, aiBudgetCheck, asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const result = await generateTimelineAiSuggestions(userId, reqLogger(req));
    res.json(result);
  }));

export default router;

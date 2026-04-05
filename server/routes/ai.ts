import { logger } from "../logger";
import { Router, type Request as ExpressRequest, type Response } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { chatWithCoach, streamChatWithCoach, parseExercisesFromText } from "../gemini/index";
import { rateLimiter, asyncHandler, validateBody } from "../routeUtils";
import { buildAIContext, type AIContext, type ChatInput } from "../services/aiContextService";
import { sanitizeRagInfo } from "../services/ragRetrieval";
import { generateTimelineAiSuggestions } from "../services/aiSuggestionService";
import { getUserId } from "../types";
import { chatRequestSchema, parseExercisesRequestSchema, insertChatMessageSchema, type InsertChatMessage } from "@shared/schema";
import { z } from "zod";

const router = Router();

router.post("/api/v1/parse-exercises", isAuthenticated, rateLimiter("parse", 5), validateBody(parseExercisesRequestSchema), asyncHandler(async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof parseExercisesRequestSchema>>, res: Response) => {
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
    const exercises = await parseExercisesFromText(text.trim(), weightUnit, customNames);
    res.json(exercises);
  }));

// validateBody(chatRequestSchema) guarantees req.body conforms, so the
// handler can read it directly without a second safeParse pass.
async function prepareChatContext(
  req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof chatRequestSchema>>,
): Promise<{ input: ChatInput; aiContext: AIContext }> {
  const { message, history } = req.body;
  const userId = getUserId(req);
  const aiContext = await buildAIContext(userId, message, req.log || logger);
  return { input: { message, history: history || [] }, aiContext };
}

router.post("/api/v1/chat", isAuthenticated, rateLimiter("chat", 10), validateBody(chatRequestSchema), asyncHandler(async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof chatRequestSchema>>, res: Response) => {
    const { input, aiContext } = await prepareChatContext(req);
    const response = await chatWithCoach(input.message, input.history, aiContext.trainingContext, aiContext.coachingMaterials, aiContext.retrievedChunks);
    res.json({ response, ragInfo: sanitizeRagInfo(aiContext.ragInfo) });
  }));

router.post("/api/v1/chat/stream", isAuthenticated, rateLimiter("chat", 10), validateBody(chatRequestSchema), asyncHandler(async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof chatRequestSchema>>, res: Response) => {
    const { input, aiContext } = await prepareChatContext(req);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Bridge Express req-close → AbortController so upstream Gemini
    // generation is torn down promptly on client disconnect
    // (CODEBASE_AUDIT.md §3).
    const controller = new AbortController();
    req.on("close", () => controller.abort());

    try {
      res.write(`data: ${JSON.stringify({ ragInfo: sanitizeRagInfo(aiContext.ragInfo) })}\n\n`);

      const stream = streamChatWithCoach(input.message, input.history, aiContext.trainingContext, aiContext.coachingMaterials, aiContext.retrievedChunks, controller.signal);

      for await (const chunk of stream) {
        if (controller.signal.aborted) {
          (req.log || logger).info("Client disconnected mid-stream, stopping AI generation");
          break;
        }
        res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }

      if (!controller.signal.aborted) {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      }
      res.end();
    } catch (streamError) {
      if (controller.signal.aborted) return;
      (req.log || logger).error({ err: streamError }, "Stream error:");
      res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`);
      res.end();
    }
  }));

router.get("/api/v1/chat/history", isAuthenticated, asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const messages = await storage.users.getChatMessages(userId);
    res.json(messages);
  }));

router.post("/api/v1/chat/message", isAuthenticated, rateLimiter("chatMessage", 20), validateBody(insertChatMessageSchema), asyncHandler(async (req: ExpressRequest<Record<string, never>, unknown, InsertChatMessage>, res: Response) => {
    const userId = getUserId(req);
    const { role, content } = req.body;

    const message = await storage.users.saveChatMessage({ userId, role, content });
    res.json(message);
  }));

router.delete("/api/v1/chat/history", isAuthenticated, rateLimiter("chatHistoryDelete", 5), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    await storage.users.clearChatHistory(userId);
    res.json({ success: true });
  }));

router.post("/api/v1/timeline/ai-suggestions", isAuthenticated, rateLimiter("suggestions", 3), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const result = await generateTimelineAiSuggestions(userId, req.log || logger);
    res.json(result);
  }));

export default router;

import { logger } from "../logger";
import { Router, type Request as ExpressRequest, type Response } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { chatWithCoach, streamChatWithCoach, generateWorkoutSuggestions, parseExercisesFromText, type UpcomingWorkout } from "../gemini/index";
import { rateLimiter, asyncHandler, validateBody } from "../routeUtils";
import { buildAIContext, extractCoachingMaterialsText, type AIContext, type ChatInput } from "../services/aiContextService";
import { getUserId } from "../types";
import { chatRequestSchema, parseExercisesRequestSchema, insertChatMessageSchema, type InsertChatMessage, type RagInfo } from "@shared/schema";
export type { RagInfo } from "@shared/schema";
import { z } from "zod";

const router = Router();

router.post("/api/v1/parse-exercises", isAuthenticated, rateLimiter("parse", 5), validateBody(parseExercisesRequestSchema), asyncHandler(async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof parseExercisesRequestSchema>>, res: Response) => {
    const { text } = req.body;
    const userId = getUserId(req);
    const user = await storage.getUser(userId);
    const weightUnit = user?.weightUnit || "kg";
    const userCustomExercises = await storage.getCustomExercises(userId);
    const customNames = userCustomExercises.map(e => e.name);
    const exercises = await parseExercisesFromText(text.trim(), weightUnit, customNames);
    res.json(exercises);
  }));

async function prepareChatContext(req: ExpressRequest): Promise<{ success: false; error: string } | { success: true; input: ChatInput; aiContext: AIContext }> {
  const parseResult = chatRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return { success: false, error: parseResult.error.errors[0].message };
  }
  const { message, history } = parseResult.data;
  const userId = getUserId(req);
  const aiContext = await buildAIContext(userId, message, req.log || logger);

  return {
    success: true,
    input: { message, history: history || [] },
    aiContext,
  };
}

router.post("/api/v1/chat", isAuthenticated, rateLimiter("chat", 10), validateBody(chatRequestSchema), asyncHandler(async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof chatRequestSchema>>, res: Response) => {
    const ctx = await prepareChatContext(req);
    if (!ctx.success) {
      return res.status(400).json({ error: ctx.error, code: "BAD_REQUEST" });
    }
    const { input, aiContext } = ctx;
    const response = await chatWithCoach(input.message, input.history, aiContext.trainingContext, aiContext.coachingMaterials, aiContext.retrievedChunks);
    res.json({ response, ragInfo: aiContext.ragInfo });
  }));

router.post("/api/v1/chat/stream", isAuthenticated, rateLimiter("chat", 10), validateBody(chatRequestSchema), asyncHandler(async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof chatRequestSchema>>, res: Response) => {
    const ctx = await prepareChatContext(req);
    if (!ctx.success) {
      return res.status(400).json({ error: ctx.error, code: "BAD_REQUEST" });
    }
    const { input, aiContext } = ctx;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let clientDisconnected = false;
    req.on("close", () => { clientDisconnected = true; });

    try {
      res.write(`data: ${JSON.stringify({ ragInfo: aiContext.ragInfo })}\n\n`);

      const stream = streamChatWithCoach(input.message, input.history, aiContext.trainingContext, aiContext.coachingMaterials, aiContext.retrievedChunks);

      for await (const chunk of stream) {
        if (clientDisconnected) {
          (req.log || logger).info("Client disconnected mid-stream, stopping AI generation");
          break;
        }
        res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }

      if (!clientDisconnected) {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      }
      res.end();
    } catch (streamError) {
      if (clientDisconnected) return;
      (req.log || logger).error({ err: streamError }, "Stream error:");
      res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`);
      res.end();
    }
  }));

router.get("/api/v1/chat/history", isAuthenticated, asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const messages = await storage.getChatMessages(userId);
    res.json(messages);
  }));

router.post("/api/v1/chat/message", isAuthenticated, rateLimiter("chatMessage", 20), validateBody(insertChatMessageSchema), asyncHandler(async (req: ExpressRequest<Record<string, never>, unknown, InsertChatMessage>, res: Response) => {
    const userId = getUserId(req);
    const { role, content } = req.body;

    const message = await storage.saveChatMessage({ userId, role, content });
    res.json(message);
  }));

router.delete("/api/v1/chat/history", isAuthenticated, rateLimiter("chatHistoryDelete", 5), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    await storage.clearChatHistory(userId);
    res.json({ success: true });
  }));

router.post("/api/v1/timeline/ai-suggestions", isAuthenticated, rateLimiter("suggestions", 3), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);

    const plannedDays = await storage.getUpcomingPlannedDays(userId, 5);
    const upcomingWorkouts: UpcomingWorkout[] = plannedDays.map((d) => ({
      id: d.planDayId,
      date: d.date,
      focus: d.focus,
      mainWorkout: d.mainWorkout,
      accessory: d.accessory || undefined,
      notes: d.notes || undefined,
    }));

    if (upcomingWorkouts.length === 0) {
      return res.json({ suggestions: [], message: "No upcoming planned workouts found" });
    }

    const suggestionQuery = upcomingWorkouts.map(w => `${w.focus} ${w.mainWorkout}`).join("; ");
    const aiContext = await buildAIContext(userId, suggestionQuery, req.log || logger);
    const coachingMaterials = extractCoachingMaterialsText(aiContext);

    const rawSuggestions = await generateWorkoutSuggestions(aiContext.trainingContext, upcomingWorkouts, undefined, coachingMaterials);

    const workoutMap = new Map(upcomingWorkouts.map(w => [w.id, w]));
    const suggestions = rawSuggestions.reduce<{ workoutId: string; date: string; focus: string; targetField: "notes" | "mainWorkout" | "accessory"; action: "replace" | "append"; recommendation: string; rationale: string; priority: "low" | "medium" | "high" }[]>((acc, s) => {
      const workout = workoutMap.get(s.workoutId);
      const mapped = {
        workoutId: s.workoutId,
        date: workout?.date || s.workoutDate || "",
        focus: workout?.focus || s.workoutFocus || "",
        targetField: s.targetField || "notes",
        action: s.action || "append",
        recommendation: s.recommendation,
        rationale: s.rationale,
        priority: s.priority,
      };
      if (mapped.date && mapped.focus && mapped.recommendation) {
        acc.push(mapped);
      }
      return acc;
    }, []);

    res.json({ suggestions, ragInfo: aiContext.ragInfo });
  }));

export default router;

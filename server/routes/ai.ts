import { logger } from "../logger";
import { Router, type Request as ExpressRequest, type Response } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { chatWithCoach, streamChatWithCoach, generateWorkoutSuggestions, parseExercisesFromText, type UpcomingWorkout } from "../gemini/index";
import { rateLimiter } from "../routeUtils";
import { buildTrainingContext } from "../services/aiService";
import { buildCoachingMaterialsSection, buildRetrievedChunksSection } from "../prompts";
import { retrieveRelevantChunks } from "../services/ragService";
import { toDateStr, getUserId } from "../types";
import { chatRequestSchema, parseExercisesRequestSchema, insertChatMessageSchema, type InsertChatMessage } from "@shared/schema";
import { z } from "zod";

const router = Router();

router.post("/api/v1/parse-exercises", isAuthenticated, rateLimiter("parse", 5), async (req: ExpressRequest<{}, any, z.infer<typeof parseExercisesRequestSchema>>, res: Response) => {
  try {
    const parseResult = parseExercisesRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Text is required" });
    }
    const { text } = parseResult.data;
    const userId = getUserId(req);
    const user = await storage.getUser(userId);
    const weightUnit = user?.weightUnit || "kg";
    const userCustomExercises = await storage.getCustomExercises(userId);
    const customNames = userCustomExercises.map(e => e.name);
    const exercises = await parseExercisesFromText(text.trim(), weightUnit, customNames);
    res.json(exercises);
  } catch (error) {
    (req.log || logger).error({ err: error }, "Error parsing exercises:");
    res.status(500).json({ error: "Failed to parse exercises" });
  }
});

/**
 * Try RAG retrieval for the user's query. Falls back to legacy if no chunks exist.
 */
async function getCoachingContext(
  userId: string,
  query: string,
): Promise<{ retrievedChunks?: string[]; coachingMaterials?: import("../prompts").CoachingMaterialInput[] }> {
  try {
    const hasChunks = await storage.hasChunksForUser(userId);
    if (hasChunks) {
      const chunks = await retrieveRelevantChunks(userId, query);
      if (chunks.length > 0) {
        return { retrievedChunks: chunks };
      }
    }
  } catch (error) {
    logger.warn({ err: error, userId }, "[rag] Retrieval failed, falling back to legacy");
  }

  // Fallback to legacy truncation
  const coachingMaterials = await storage.listCoachingMaterials(userId);
  return { coachingMaterials };
}

async function prepareChatContext(req: ExpressRequest): Promise<{ success: false; error: string } | { success: true; message: string; history: Pick<import("@shared/schema").ChatMessage, "role" | "content">[]; trainingContext: import("../gemini/index").TrainingContext; coachingMaterials?: import("../prompts").CoachingMaterialInput[]; retrievedChunks?: string[] }> {
  const parseResult = chatRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return { success: false, error: parseResult.error.errors[0].message };
  }
  const { message, history } = parseResult.data;

  const userId = getUserId(req);
  const [trainingContext, coachingContext] = await Promise.all([
    buildTrainingContext(userId),
    getCoachingContext(userId, message),
  ]);

  if (!trainingContext) {
    return { success: false, error: "Training context could not be loaded" };
  }

  return {
    success: true,
    message,
    history: history || [],
    trainingContext,
    ...coachingContext,
  };
}

router.post("/api/v1/chat", isAuthenticated, rateLimiter("chat", 10), async (req: ExpressRequest<{}, any, z.infer<typeof chatRequestSchema>>, res: Response) => {
  try {
    const context = await prepareChatContext(req);
    if (!context.success) {
      return res.status(400).json({ error: context.error });
    }
    const { message, history, trainingContext, coachingMaterials, retrievedChunks } = context;

    const response = await chatWithCoach(message, history, trainingContext, coachingMaterials, retrievedChunks);
    res.json({ response });
  } catch (error) {
    (req.log || logger).error({ err: error }, "Chat error:");
    res.status(500).json({ error: "Failed to get response from AI coach" });
  }
});

router.post("/api/v1/chat/stream", isAuthenticated, rateLimiter("chat", 10), async (req: ExpressRequest<{}, any, z.infer<typeof chatRequestSchema>>, res: Response) => {
  try {
    const context = await prepareChatContext(req);
    if (!context.success) {
      return res.status(400).json({ error: context.error });
    }
    const { message, history, trainingContext, coachingMaterials, retrievedChunks } = context;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      const stream = streamChatWithCoach(message, history, trainingContext, coachingMaterials, retrievedChunks);

      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (streamError) {
      (req.log || logger).error({ err: streamError }, "Stream error:");
      res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`);
      res.end();
    }
  } catch (error) {
    (req.log || logger).error({ err: error }, "Chat stream error:");
    res.status(500).json({ error: "Failed to get response from AI coach" });
  }
});

router.get("/api/v1/chat/history", isAuthenticated, async (req: ExpressRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const messages = await storage.getChatMessages(userId);
    res.json(messages);
  } catch (error) {
    (req.log || logger).error({ err: error }, "Get chat history error:");
    res.status(500).json({ error: "Failed to get chat history" });
  }
});

router.post("/api/v1/chat/message", isAuthenticated, rateLimiter("chatMessage", 20), async (req: ExpressRequest<{}, any, InsertChatMessage>, res: Response) => {
  try {
    const parseResult = insertChatMessageSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Role and content are required", details: parseResult.error });
    }

    const userId = getUserId(req);
    const { role, content } = parseResult.data;

    const message = await storage.saveChatMessage({ userId, role, content });
    res.json(message);
  } catch (error) {
    (req.log || logger).error({ err: error }, "Save chat message error:");
    res.status(500).json({ error: "Failed to save message" });
  }
});

router.delete("/api/v1/chat/history", isAuthenticated, rateLimiter("chatHistoryDelete", 5), async (req: ExpressRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    await storage.clearChatHistory(userId);
    res.json({ success: true });
  } catch (error) {
    (req.log || logger).error({ err: error }, "Clear chat history error:");
    res.status(500).json({ error: "Failed to clear chat history" });
  }
});

router.post("/api/v1/timeline/ai-suggestions", isAuthenticated, rateLimiter("suggestions", 3), async (req: ExpressRequest, res: Response) => {
  try {
    const userId = getUserId(req);

    const timeline = await storage.getTimeline(userId);
    const today = toDateStr();

    const upcomingWorkouts: UpcomingWorkout[] = timeline
      .filter(entry =>
        entry.status === "planned" &&
        entry.date &&
        entry.date >= today &&
        entry.planDayId !== null
      )
      .sort((a, b) => {
        if (b.date < a.date) return 1;
        if (b.date > a.date) return -1;
        return 0;
      })
      .slice(0, 5)
      .map(entry => ({
        id: entry.planDayId || "",
        date: entry.date,
        focus: entry.focus || "",
        mainWorkout: entry.mainWorkout || "",
        accessory: entry.accessory || undefined,
        notes: entry.notes || undefined,
      }));

    if (upcomingWorkouts.length === 0) {
      return res.json({ suggestions: [], message: "No upcoming planned workouts found" });
    }

    // Build a query from upcoming workout context for RAG retrieval
    const suggestionQuery = upcomingWorkouts.map(w => `${w.focus} ${w.mainWorkout}`).join("; ");

    const [trainingContext, coachingContext] = await Promise.all([
      buildTrainingContext(userId),
      getCoachingContext(userId, suggestionQuery),
    ]);

    // Build coaching materials string for suggestions prompt
    let coachingMaterials: string | undefined;
    if (coachingContext.retrievedChunks && coachingContext.retrievedChunks.length > 0) {
      coachingMaterials = buildRetrievedChunksSection(coachingContext.retrievedChunks);
    } else if (coachingContext.coachingMaterials) {
      coachingMaterials = buildCoachingMaterialsSection(coachingContext.coachingMaterials) || undefined;
    }

    const rawSuggestions = await generateWorkoutSuggestions(trainingContext, upcomingWorkouts, undefined, coachingMaterials);

    const workoutMap = new Map(upcomingWorkouts.map(w => [w.id, w]));
    const suggestions = rawSuggestions
      .map(s => {
        const workout = workoutMap.get(s.workoutId);
        return {
          workoutId: s.workoutId,
          date: workout?.date || s.workoutDate || "",
          focus: workout?.focus || s.workoutFocus || "",
          targetField: s.targetField || "notes",
          action: s.action || "append",
          recommendation: s.recommendation,
          rationale: s.rationale,
          priority: s.priority,
        };
      })
      .filter(s => s.date && s.focus && s.recommendation);

    res.json({ suggestions });
  } catch (error) {
    (req.log || logger).error({ err: error }, "AI suggestions error:");
    res.status(500).json({ error: "Failed to generate AI suggestions" });
  }
});

export default router;

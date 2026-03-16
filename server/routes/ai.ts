import { Router } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { chatWithCoach, streamChatWithCoach, generateWorkoutSuggestions, parseExercisesFromText, type ChatMessage, type UpcomingWorkout } from "../gemini";
import { rateLimiter, asyncRoute } from "../routeUtils";
import { buildTrainingContext } from "../services/aiService";
import { toDateStr, getUserId, AuthenticatedRequest } from "../types";
import { chatRequestSchema, parseExercisesRequestSchema, insertChatMessageSchema } from "@shared/schema";

const router = Router();

router.post("/api/parse-exercises", isAuthenticated, rateLimiter("parse", 5), async (req: AuthenticatedRequest, res) => {
  try {
    const parseResult = parseExercisesRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Text is required" });
    }
    const { text } = parseResult.data;
    const userId = getUserId(req) ;
    const user = await storage.getUser(userId);
    const weightUnit = user?.weightUnit || "kg";
    const userCustomExercises = await storage.getCustomExercises(userId);
    const customNames = userCustomExercises.map(e => e.name);
    const exercises = await parseExercisesFromText(text.trim(), weightUnit, customNames);
    res.json(exercises);
  } catch (error) {
    console.error("Error parsing exercises:", error);
    res.status(500).json({ error: "Failed to parse exercises" });
  }
});

async function prepareChatContext(req: AuthenticatedRequest) {
  const parseResult = chatRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return { success: false as const, error: parseResult.error.errors[0].message };
  }
  const { message, history } = parseResult.data;

  const userId = getUserId(req) ;
  const trainingContext = await buildTrainingContext(userId );

  return { success: true as const, message, history, trainingContext };
}

router.post("/api/chat", isAuthenticated, rateLimiter("chat", 10), async (req: AuthenticatedRequest, res) => {
  try {
    const context = await prepareChatContext(req);
    if (!context.success) {
      return res.status(400).json({ error: context.error });
    }
    const { message, history, trainingContext } = context;

    const response = await chatWithCoach(message, history, trainingContext);
    res.json({ response });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: "Failed to get response from AI coach" });
  }
});

router.post("/api/chat/stream", isAuthenticated, rateLimiter("chat", 10), async (req: AuthenticatedRequest, res) => {
  try {
    const context = await prepareChatContext(req);
    if (!context.success) {
      return res.status(400).json({ error: context.error });
    }
    const { message, history, trainingContext } = context;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      const stream = streamChatWithCoach(message, history, trainingContext);

      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (streamError) {
      console.error("Stream error:", streamError);
      res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`);
      res.end();
    }
  } catch (error) {
    console.error("Chat stream error:", error);
    res.status(500).json({ error: "Failed to get response from AI coach" });
  }
});

router.get("/api/chat/history", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req) ;
    const messages = await storage.getChatMessages(userId);
    res.json(messages);
  } catch (error) {
    console.error("Get chat history error:", error);
    res.status(500).json({ error: "Failed to get chat history" });
  }
});

router.post("/api/chat/message", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const parseResult = insertChatMessageSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Role and content are required", details: parseResult.error });
    }

    const userId = getUserId(req) ;
    const { role, content } = parseResult.data;

    const message = await storage.saveChatMessage({ userId, role, content });
    res.json(message);
  } catch (error) {
    console.error("Save chat message error:", error);
    res.status(500).json({ error: "Failed to save message" });
  }
});

router.delete("/api/chat/history", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req) ;
    await storage.clearChatHistory(userId);
    res.json({ success: true });
  } catch (error) {
    console.error("Clear chat history error:", error);
    res.status(500).json({ error: "Failed to clear chat history" });
  }
});

router.post("/api/timeline/ai-suggestions", isAuthenticated, rateLimiter("suggestions", 3), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req) ;

    const trainingContext = await buildTrainingContext(userId );

    const timeline = await storage.getTimeline(userId);
    const today = toDateStr();

    const upcomingWorkouts: UpcomingWorkout[] = timeline
      .filter(entry =>
        entry.status === "planned" &&
        entry.date &&
        entry.date >= today &&
        entry.planDayId !== null
      )
      .sort((a, b) => a.date!.localeCompare(b.date!))
      .slice(0, 5)
      .map(entry => ({
        id: entry.planDayId as string,
        date: entry.date!,
        focus: entry.focus || "",
        mainWorkout: entry.mainWorkout || "",
        accessory: entry.accessory || undefined,
      }));

    if (upcomingWorkouts.length === 0) {
      return res.json({ suggestions: [], message: "No upcoming planned workouts found" });
    }

    const rawSuggestions = await generateWorkoutSuggestions(trainingContext, upcomingWorkouts);

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
    console.error("AI suggestions error:", error);
    res.status(500).json({ error: "Failed to generate AI suggestions" });
  }
});

export default router;

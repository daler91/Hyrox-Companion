import { Router } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { chatWithCoach, streamChatWithCoach, generateWorkoutSuggestions, parseExercisesFromText, type ChatMessage, type UpcomingWorkout } from "../gemini";
import { rateLimiter } from "../routeUtils";
import { buildTrainingContext } from "../services/aiService";
import { toDateStr, getUserId } from "../types";

const router = Router();

const MAX_MESSAGE_LENGTH = 5000;
const MAX_HISTORY_ITEMS = 20;

function validateChatBody(body: any): { message: string; history: ChatMessage[] } | { error: string } {
  const { message, history } = body || {};

  if (!message || typeof message !== "string" || !message.trim()) {
    return { error: "Message is required" };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { error: `Message must be ${MAX_MESSAGE_LENGTH} characters or less` };
  }

  let validatedHistory: ChatMessage[] = [];
  if (history) {
    if (!Array.isArray(history)) {
      return { error: "History must be an array" };
    }
    const trimmed = history.slice(-MAX_HISTORY_ITEMS);
    for (const item of trimmed) {
      if (!item || typeof item.role !== "string" || typeof item.content !== "string") {
        return { error: "Each history item must have a role and content string" };
      }
      if (item.role !== "user" && item.role !== "assistant") {
        return { error: "History item role must be 'user' or 'assistant'" };
      }
      if (item.content.length > MAX_MESSAGE_LENGTH) {
        return { error: `History item content must be ${MAX_MESSAGE_LENGTH} characters or less` };
      }
      validatedHistory.push({ role: item.role, content: item.content });
    }
  }

  return { message, history: validatedHistory };
}

router.post("/api/parse-exercises", isAuthenticated, rateLimiter("parse", 5), async (req: any, res) => {
  try {
    const { text } = req.body as { text: string };
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Text is required" });
    }
    const userId = getUserId(req);
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

router.post("/api/chat", isAuthenticated, rateLimiter("chat", 10), async (req: any, res) => {
  try {
    const validated = validateChatBody(req.body);
    if ("error" in validated) {
      return res.status(400).json({ error: validated.error });
    }
    const { message, history } = validated;

    const userId = getUserId(req);
    const trainingContext = await buildTrainingContext(userId);

    const response = await chatWithCoach(message, history, trainingContext);
    res.json({ response });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: "Failed to get response from AI coach" });
  }
});

router.post("/api/chat/stream", isAuthenticated, rateLimiter("chat", 10), async (req: any, res) => {
  try {
    const validated = validateChatBody(req.body);
    if ("error" in validated) {
      return res.status(400).json({ error: validated.error });
    }
    const { message, history } = validated;

    const userId = getUserId(req);
    const trainingContext = await buildTrainingContext(userId);

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

router.get("/api/chat/history", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const messages = await storage.getChatMessages(userId);
    res.json(messages);
  } catch (error) {
    console.error("Get chat history error:", error);
    res.status(500).json({ error: "Failed to get chat history" });
  }
});

router.post("/api/chat/message", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const { role, content } = req.body as { role: string; content: string };

    if (!role || !content) {
      return res.status(400).json({ error: "Role and content are required" });
    }

    const message = await storage.saveChatMessage({ userId, role, content });
    res.json(message);
  } catch (error) {
    console.error("Save chat message error:", error);
    res.status(500).json({ error: "Failed to save message" });
  }
});

router.delete("/api/chat/history", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    await storage.clearChatHistory(userId);
    res.json({ success: true });
  } catch (error) {
    console.error("Clear chat history error:", error);
    res.status(500).json({ error: "Failed to clear chat history" });
  }
});

router.post("/api/timeline/ai-suggestions", isAuthenticated, rateLimiter("suggestions", 3), async (req: any, res) => {
  try {
    const userId = getUserId(req);

    const trainingContext = await buildTrainingContext(userId);

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
        id: entry.planDayId!,
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

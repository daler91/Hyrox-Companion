import { logger } from "../logger";
import { Router, type Request as ExpressRequest, type Response } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { chatWithCoach, streamChatWithCoach, generateWorkoutSuggestions, parseExercisesFromText, EMBEDDING_DIMENSIONS, type UpcomingWorkout } from "../gemini/index";
import { rateLimiter, asyncHandler, validateBody } from "../routeUtils";
import { buildTrainingContext } from "../services/aiService";
import { buildCoachingMaterialsSection, buildRetrievedChunksSection } from "../prompts";
import { retrieveRelevantChunks } from "../services/ragService";
import { toDateStr, getUserId } from "../types";
import { chatRequestSchema, parseExercisesRequestSchema, insertChatMessageSchema, type InsertChatMessage, type RagInfo } from "@shared/schema";
import { z } from "zod";

export type { RagInfo };

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

async function getCoachingContext(
  userId: string,
  query: string,
  log: Pick<typeof logger, "warn" | "info" | "error"> = logger,
): Promise<{ retrievedChunks?: string[]; coachingMaterials?: import("../prompts").CoachingMaterialInput[]; ragInfo: RagInfo }> {
  let fallbackReason: string | undefined;

  try {
    const hasChunks = await storage.hasChunksForUser(userId);

    if (hasChunks) {
      // Check if stored embeddings match the current model's dimensions
      const storedDim = await storage.getStoredEmbeddingDimension(userId);
      if (storedDim !== null && storedDim !== EMBEDDING_DIMENSIONS) {
        log.warn(
          { userId, storedDim, expectedDim: EMBEDDING_DIMENSIONS },
          "[rag] Embedding dimension mismatch — skipping RAG (re-embed via settings to fix)",
        );
        fallbackReason = `dimension_mismatch: stored=${storedDim}, expected=${EMBEDDING_DIMENSIONS}`;
      } else {
        const chunks = await retrieveRelevantChunks(userId, query);
        if (chunks.length > 0) {
          return {
            retrievedChunks: chunks,
            ragInfo: { source: "rag", chunkCount: chunks.length, chunks },
          };
        }
        fallbackReason = storedDim === null
          ? "no_embeddings: chunks exist but none have embeddings — click Re-embed All"
          : "no_matching_chunks: search returned 0 results";
        log.warn({ userId, storedDim, fallbackReason }, "[rag] Retrieval returned 0 chunks");
      }
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    fallbackReason = `retrieval_error: ${errMsg}`;
    log.error({ err: error, userId }, "[rag] Retrieval failed, falling back to legacy");
  }

  // Fallback to legacy truncation
  const coachingMaterials = await storage.listCoachingMaterials(userId);
  return {
    coachingMaterials,
    ragInfo: {
      source: coachingMaterials.length > 0 ? "legacy" : "none",
      chunkCount: 0,
      materialCount: coachingMaterials.length,
      fallbackReason,
    },
  };
}

async function prepareChatContext(req: ExpressRequest): Promise<{ success: false; error: string } | { success: true; message: string; history: Pick<import("@shared/schema").ChatMessage, "role" | "content">[]; trainingContext: import("../gemini/index").TrainingContext; coachingMaterials?: import("../prompts").CoachingMaterialInput[]; retrievedChunks?: string[]; ragInfo: RagInfo }> {
  const parseResult = chatRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return { success: false, error: parseResult.error.errors[0].message };
  }
  const { message, history } = parseResult.data;

  const userId = getUserId(req);
  const [trainingContext, coachingContext] = await Promise.all([
    buildTrainingContext(userId),
    getCoachingContext(userId, message, req.log || logger),
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

router.post("/api/v1/chat", isAuthenticated, rateLimiter("chat", 10), validateBody(chatRequestSchema), asyncHandler(async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof chatRequestSchema>>, res: Response) => {
    const context = await prepareChatContext(req);
    if (!context.success) {
      return res.status(400).json({ error: context.error, code: "BAD_REQUEST" });
    }
    const { message, history, trainingContext, coachingMaterials, retrievedChunks, ragInfo } = context;

    const response = await chatWithCoach(message, history, trainingContext, coachingMaterials, retrievedChunks);
    res.json({ response, ragInfo });
  }));

router.post("/api/v1/chat/stream", isAuthenticated, rateLimiter("chat", 10), validateBody(chatRequestSchema), asyncHandler(async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof chatRequestSchema>>, res: Response) => {
    const context = await prepareChatContext(req);
    if (!context.success) {
      return res.status(400).json({ error: context.error, code: "BAD_REQUEST" });
    }
    const { message, history, trainingContext, coachingMaterials, retrievedChunks, ragInfo } = context;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Emit RAG diagnostics before streaming text
    try {
      // Emit RAG diagnostics before streaming text
      res.write(`data: ${JSON.stringify({ ragInfo })}\n\n`);

      const stream = streamChatWithCoach(message, history, trainingContext, coachingMaterials, retrievedChunks);

      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (streamError) {
      const log = req.log || logger;
      log.error({ err: streamError }, "Stream error:");
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
      getCoachingContext(userId, suggestionQuery, req.log || logger),
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
    // ⚡ Bolt Performance Optimization:
    // Combine map and filter into a single O(N) reduction to prevent
    // intermediate array allocations.
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

    res.json({ suggestions, ragInfo: coachingContext.ragInfo });
  }));

export default router;

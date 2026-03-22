import { logger } from "../logger";
import { Router, type Request as ExpressRequest, type Response } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { rateLimiter, asyncHandler } from "../routeUtils";
import { getUserId } from "../types";
import { insertCoachingMaterialSchema } from "@shared/schema";
import { getRagStatus, reembedAllMaterials } from "../services/ragService";
import { queue } from "../queue";
import { z } from "zod";

const router = Router();

const updateCoachingMaterialSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  content: z.string().trim().min(1).max(1500000).optional(),
  type: z.enum(["principles", "document"]).optional(),
});

router.get("/api/v1/coaching-materials", isAuthenticated, asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const materials = await storage.listCoachingMaterials(userId);
    res.json(materials);
  }));

router.post("/api/v1/coaching-materials", isAuthenticated, rateLimiter("coaching", 10), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const parseResult = insertCoachingMaterialSchema.safeParse({ ...req.body, userId });
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid data", details: parseResult.error.issues });
    }
    const material = await storage.createCoachingMaterial(parseResult.data);

    // Fire-and-forget: chunk and embed in background
    queue.send("embed-coaching-material", { material }).catch(err => (req.log || logger).error({ err }, "Failed to queue coaching material embedding"));

    res.status(201).json(material);
  }));

router.patch("/api/v1/coaching-materials/:id", isAuthenticated, rateLimiter("coaching", 10), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const parseResult = updateCoachingMaterialSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid data", details: parseResult.error.issues });
    }
    const material = await storage.updateCoachingMaterial(req.params.id, parseResult.data, userId);
    if (!material) {
      return res.status(404).json({ error: "Coaching material not found" });
    }

    // Re-embed if content or title changed
    if (parseResult.data.content || parseResult.data.title) {
      queue.send("embed-coaching-material", { material }).catch(err => (req.log || logger).error({ err }, "Failed to queue coaching material embedding"));
    }

    res.json(material);
  }));

router.get("/api/v1/coaching-materials/rag-status", isAuthenticated, asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const result = await getRagStatus(userId);
    res.json(result);
  }));

router.post("/api/v1/coaching-materials/re-embed", isAuthenticated, rateLimiter("coaching", 5), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const result = await reembedAllMaterials(userId);
    res.json(result);
  }));

router.delete("/api/v1/coaching-materials/:id", isAuthenticated, rateLimiter("coaching", 10), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    // Chunks are cascade-deleted via FK, no manual cleanup needed
    const deleted = await storage.deleteCoachingMaterial(req.params.id, userId);
    if (!deleted) {
      return res.status(404).json({ error: "Coaching material not found" });
    }
    res.json({ success: true });
  }));

export default router;

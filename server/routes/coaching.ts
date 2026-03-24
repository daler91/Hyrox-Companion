import { logger } from "../logger";
import { Router, type Request as ExpressRequest, type Response } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { rateLimiter, asyncHandler, validateBody } from "../routeUtils";
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

const createMaterialSchema = insertCoachingMaterialSchema.omit({ userId: true });
router.post("/api/v1/coaching-materials", isAuthenticated, rateLimiter("coaching", 10), validateBody(createMaterialSchema), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const material = await storage.createCoachingMaterial({ ...req.body, userId });

    // Fire-and-forget: chunk and embed in background (send only ID to avoid pg-boss payload limits)
    queue.send("embed-coaching-material", { materialId: material.id, userId }).catch(err => (req.log || logger).error({ err }, "Failed to queue coaching material embedding"));

    res.status(201).json(material);
  }));

router.patch("/api/v1/coaching-materials/:id", isAuthenticated, rateLimiter("coaching", 10), validateBody(updateCoachingMaterialSchema), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const material = await storage.updateCoachingMaterial(req.params.id, req.body, userId);
    if (!material) {
      return res.status(404).json({ error: "Coaching material not found", code: "NOT_FOUND" });
    }

    // Re-embed if content or title changed
    if (req.body.content || req.body.title) {
      queue.send("embed-coaching-material", { materialId: material.id, userId }).catch(err => (req.log || logger).error({ err }, "Failed to queue coaching material embedding"));
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
      return res.status(404).json({ error: "Coaching material not found", code: "NOT_FOUND" });
    }
    res.json({ success: true });
  }));

export default router;

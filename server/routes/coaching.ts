import { type InsertCoachingMaterial,insertCoachingMaterialSchema } from "@shared/schema";
import { type Request as ExpressRequest, type Response,Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../clerkAuth";
import { reqLogger } from "../logger";
import { sendJob } from "../queue";
import { asyncHandler, rateLimiter, sendNotFound, validateBody } from "../routeUtils";
import { getRagStatus, reembedAllMaterials } from "../services/ragService";
import { storage } from "../storage";
import { getUserId } from "../types";
import { protectedDelete, protectedPatch, protectedPost } from "./_helpers/protectedRouteBuilder";

const router = Router();

const updateCoachingMaterialSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  content: z.string().trim().min(1).max(1500000).optional(),
  type: z.enum(["principles", "document"]).optional(),
});

type CreateMaterialBody = Omit<InsertCoachingMaterial, "userId">;
type UpdateMaterialBody = z.infer<typeof updateCoachingMaterialSchema>;

// 🛡️ Sentinel: Added rate limit to GET /api/v1/coaching-materials to prevent enumeration/abuse
router.get("/api/v1/coaching-materials", isAuthenticated, rateLimiter("coaching", 60), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const materials = await storage.coaching.listCoachingMaterials(userId);
    res.json(materials);
  }));

const createMaterialSchema = insertCoachingMaterialSchema.omit({ userId: true });
protectedPost(router, "/api/v1/coaching-materials", { limiter: rateLimiter("coaching", 10), aiConsent: true, aiBudget: true, validation: [validateBody(createMaterialSchema)] }, async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const body = req.body as CreateMaterialBody;
    const material = await storage.coaching.createCoachingMaterial({ ...body, userId });

    // Fire-and-forget: chunk and embed in background (send only ID to avoid pg-boss payload limits)
    sendJob("embed-coaching-material", { materialId: material.id, userId }).catch(err => reqLogger(req).error({ err }, "Failed to queue coaching material embedding"));

    res.status(201).json(material);
  });

protectedPatch(router, "/api/v1/coaching-materials/:id", { limiter: rateLimiter("coaching", 10), aiConsent: true, aiBudget: true, validation: [validateBody(updateCoachingMaterialSchema)] }, async (req: ExpressRequest<{ id: string }>, res: Response) => {
    const userId = getUserId(req);
    const body = req.body as UpdateMaterialBody;
    const material = await storage.coaching.updateCoachingMaterial(req.params.id, body, userId);
    if (!material) {
      return sendNotFound(res, "Coaching material not found");
    }

    // Re-embed if content or title changed
    if (body.content || body.title) {
      sendJob("embed-coaching-material", { materialId: material.id, userId }).catch(err => reqLogger(req).error({ err }, "Failed to queue coaching material embedding"));
    }

    res.json(material);
  });

// 🛡️ Sentinel: Added rate limit to GET /api/v1/coaching-materials/rag-status to prevent enumeration/abuse
router.get("/api/v1/coaching-materials/rag-status", isAuthenticated, rateLimiter("coaching", 60), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const result = await getRagStatus(userId);
    res.json(result);
  }));

protectedPost(router, "/api/v1/coaching-materials/re-embed", { limiter: rateLimiter("coaching", 5), aiConsent: true, aiBudget: true }, async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const result = await reembedAllMaterials(userId);
    res.json(result);
  });

protectedDelete(router, "/api/v1/coaching-materials/:id", { limiter: rateLimiter("coaching", 10) }, async (req: ExpressRequest<{ id: string }>, res: Response) => {
    const userId = getUserId(req);
    // Chunks are cascade-deleted via FK, no manual cleanup needed
    const deleted = await storage.coaching.deleteCoachingMaterial(req.params.id, userId);
    if (!deleted) {
      return sendNotFound(res, "Coaching material not found");
    }
    res.json({ success: true });
  });

export default router;

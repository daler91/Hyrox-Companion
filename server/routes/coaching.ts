import { Router, type Request as ExpressRequest, type Response } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { rateLimiter } from "../routeUtils";
import { getUserId } from "../types";
import { insertCoachingMaterialSchema } from "@shared/schema";
import { logger } from "../logger";
import { getRagStatus, reembedAllMaterials } from "../services/ragService";
import { queue } from "../queue";
import { z } from "zod";

const router = Router();

const updateCoachingMaterialSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  content: z.string().trim().min(1).max(1500000).optional(),
  type: z.enum(["principles", "document"]).optional(),
});

router.get("/api/v1/coaching-materials", isAuthenticated, async (req: ExpressRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const materials = await storage.listCoachingMaterials(userId);
    res.json(materials);
  } catch (error) {
    (req.log || logger).error({ err: error }, "Error listing coaching materials:");
    res.status(500).json({ error: "Failed to list coaching materials" });
  }
});

router.post("/api/v1/coaching-materials", isAuthenticated, rateLimiter("coaching", 10), async (req: ExpressRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const parseResult = insertCoachingMaterialSchema.safeParse({ ...req.body, userId });
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid data", details: parseResult.error.issues });
    }
    const material = await storage.createCoachingMaterial(parseResult.data);

    // Fire-and-forget: chunk and embed in background
    queue.send("embed-coaching-material", { material }).catch(err => (req.log || logger).error({ err }, "Failed to queue coaching material embedding"));

    res.status(201).json(material);
  } catch (error) {
    (req.log || logger).error({ err: error }, "Error creating coaching material:");
    res.status(500).json({ error: "Failed to create coaching material" });
  }
});

router.patch("/api/v1/coaching-materials/:id", isAuthenticated, rateLimiter("coaching", 10), async (req: ExpressRequest, res: Response) => {
  try {
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
  } catch (error) {
    (req.log || logger).error({ err: error }, "Error updating coaching material:");
    res.status(500).json({ error: "Failed to update coaching material" });
  }
});

router.get("/api/v1/coaching-materials/rag-status", isAuthenticated, async (req: ExpressRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const result = await getRagStatus(userId);
    res.json(result);
  } catch (error) {
    (req.log || logger).error({ err: error }, "Error fetching RAG status:");
    res.status(500).json({ error: "Failed to fetch RAG status" });
  }
});

router.post("/api/v1/coaching-materials/re-embed", isAuthenticated, rateLimiter("coaching", 5), async (req: ExpressRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const result = await reembedAllMaterials(userId);
    res.json(result);
  } catch (error) {
    (req.log || logger).error({ err: error }, "Error re-embedding coaching materials:");
    res.status(500).json({ error: "Failed to re-embed coaching materials", details: error instanceof Error ? error.message : String(error) });
  }
});

router.delete("/api/v1/coaching-materials/:id", isAuthenticated, rateLimiter("coaching", 10), async (req: ExpressRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    // Chunks are cascade-deleted via FK, no manual cleanup needed
    const deleted = await storage.deleteCoachingMaterial(req.params.id, userId);
    if (!deleted) {
      return res.status(404).json({ error: "Coaching material not found" });
    }
    res.json({ success: true });
  } catch (error) {
    (req.log || logger).error({ err: error }, "Error deleting coaching material:");
    res.status(500).json({ error: "Failed to delete coaching material" });
  }
});

export default router;

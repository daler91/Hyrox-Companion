import { Router, type Request as ExpressRequest, type Response } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { rateLimiter } from "../routeUtils";
import { getUserId } from "../types";
import { insertCoachingMaterialSchema } from "@shared/schema";
import { logger } from "../logger";
import { embedCoachingMaterial } from "../services/ragService";
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
    embedCoachingMaterial(material).catch((err) =>
      logger.error({ err, materialId: material.id }, "[rag] Background embedding failed"),
    );

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
      embedCoachingMaterial(material).catch((err) =>
        logger.error({ err, materialId: material.id }, "[rag] Background re-embedding failed"),
      );
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
    const materials = await storage.listCoachingMaterials(userId);
    const chunkCounts = await storage.getChunkCountsByMaterial(userId);
    const chunkMap = new Map(chunkCounts.map((c) => [c.materialId, c]));

    const hasApiKey = Boolean(process.env.GEMINI_API_KEY);

    const materialStatus = materials.map((m) => {
      const chunks = chunkMap.get(m.id);
      return {
        id: m.id,
        title: m.title,
        type: m.type,
        contentLength: m.content.length,
        chunkCount: chunks?.chunkCount ?? 0,
        hasEmbeddings: chunks?.hasEmbeddings ?? false,
      };
    });

    const totalChunks = chunkCounts.reduce((sum, c) => sum + c.chunkCount, 0);
    const allEmbedded = materials.length > 0 && materials.every((m) => chunkMap.get(m.id)?.hasEmbeddings);

    res.json({
      hasApiKey,
      totalMaterials: materials.length,
      totalChunks,
      allEmbedded,
      materials: materialStatus,
    });
  } catch (error) {
    (req.log || logger).error({ err: error }, "Error fetching RAG status:");
    res.status(500).json({ error: "Failed to fetch RAG status" });
  }
});

router.post("/api/v1/coaching-materials/re-embed", isAuthenticated, rateLimiter("coaching", 5), async (req: ExpressRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const materials = await storage.listCoachingMaterials(userId);
    const errors: string[] = [];
    let count = 0;
    for (const material of materials) {
      try {
        await embedCoachingMaterial(material);
        count++;
      } catch (err) {
        errors.push(`${material.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    res.json({ success: true, materialsProcessed: count, errors });
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

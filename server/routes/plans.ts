import { Router } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { updatePlanDaySchema, importPlanRequestSchema, schedulePlanRequestSchema } from "@shared/schema";
import { getUserId, AuthenticatedRequest } from "../types";
import { importPlanFromCSV, createSamplePlan, updatePlanDayWithCleanup } from "../services/planService";
import { rateLimiter } from "../routeUtils";

const router = Router();

router.get("/api/plans", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const plans = await storage.listTrainingPlans(userId);
    res.json(plans);
  } catch (error) {
    console.error("List plans error:", error);
    res.status(500).json({ error: "Failed to list training plans" });
  }
});

router.get("/api/plans/:id", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const plan = await storage.getTrainingPlan(req.params.id, userId);
    if (!plan) {
      return res.status(404).json({ error: "Training plan not found" });
    }
    res.json(plan);
  } catch (error) {
    console.error("Get plan error:", error);
    res.status(500).json({ error: "Failed to get training plan" });
  }
});

router.post("/api/plans/import", isAuthenticated, rateLimiter("planImport", 5), async (req: AuthenticatedRequest, res) => {
  try {
    const parseResult = importPlanRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "CSV content is required" });
    }
    const { csvContent, fileName, planName } = parseResult.data;

    const userId = getUserId(req);
    const fullPlan = await importPlanFromCSV(csvContent, userId, { fileName, planName });
    res.json(fullPlan);
  } catch (error: Error | any) {
    if (error.message === "No valid rows found in CSV" || error.message === "No valid week numbers found in CSV") {
      return res.status(400).json({ error: error.message });
    }
    console.error("Import plan error:", error);
    res.status(500).json({ error: "Failed to import training plan" });
  }
});

router.post("/api/plans/sample", isAuthenticated, rateLimiter("planSample", 5), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const fullPlan = await createSamplePlan(userId);
    res.json(fullPlan);
  } catch (error) {
    console.error("Create sample plan error:", error);
    res.status(500).json({ error: "Failed to create sample plan" });
  }
});

router.patch("/api/plans/:planId/days/:dayId", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const { dayId } = req.params;
    const userId = getUserId(req);

    const parseResult = updatePlanDaySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid update data", details: parseResult.error });
    }

    const updatedDay = await storage.updatePlanDay(dayId, parseResult.data, userId);
    if (!updatedDay) {
      return res.status(404).json({ error: "Day not found" });
    }

    res.json(updatedDay);
  } catch (error) {
    console.error("Update day error:", error);
    res.status(500).json({ error: "Failed to update day" });
  }
});

router.patch("/api/plans/days/:dayId", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const { dayId } = req.params;
    const userId = getUserId(req);

    const parseResult = updatePlanDaySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid update data", details: parseResult.error });
    }

    const updatedDay = await updatePlanDayWithCleanup(dayId, parseResult.data, userId);
    if (!updatedDay) {
      return res.status(404).json({ error: "Day not found" });
    }

    res.json(updatedDay);
  } catch (error) {
    console.error("Update day error:", error);
    res.status(500).json({ error: "Failed to update day" });
  }
});

router.patch("/api/plans/:id", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const { name } = req.body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Name is required" });
    }
    const updated = await storage.renameTrainingPlan(req.params.id, name.trim(), userId);
    if (!updated) {
      return res.status(404).json({ error: "Training plan not found" });
    }
    res.json(updated);
  } catch (error) {
    console.error("Rename plan error:", error);
    res.status(500).json({ error: "Failed to rename training plan" });
  }
});

router.delete("/api/plans/:id", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const deleted = await storage.deleteTrainingPlan(req.params.id, userId);
    if (!deleted) {
      return res.status(404).json({ error: "Training plan not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Delete plan error:", error);
    res.status(500).json({ error: "Failed to delete training plan" });
  }
});

router.post("/api/plans/:planId/schedule", isAuthenticated, rateLimiter("planSchedule", 10), async (req: AuthenticatedRequest, res) => {
  try {
    const parseResult = schedulePlanRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid start date format. Must be YYYY-MM-DD" });
    }
    const { startDate } = parseResult.data;

    const userId = getUserId(req);
    const { planId } = req.params;

    const success = await storage.schedulePlan(planId, startDate, userId);
    if (!success) {
      return res.status(404).json({ error: "Training plan not found" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Schedule plan error:", error);
    res.status(500).json({ error: "Failed to schedule training plan" });
  }
});

router.patch("/api/plans/days/:dayId/status", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const { dayId } = req.params;
    const userId = getUserId(req);
    const { status, scheduledDate } = req.body as { status?: string; scheduledDate?: string };

    const updates: Record<string, string | null> = {};
    if (status) updates.status = status;
    if (scheduledDate !== undefined) updates.scheduledDate = scheduledDate;

    if (status && status !== "completed") {
      await storage.deleteWorkoutLogByPlanDayId(dayId, userId);
    }

    const updatedDay = await storage.updatePlanDay(dayId, updates, userId);
    if (!updatedDay) {
      return res.status(404).json({ error: "Day not found" });
    }

    res.json(updatedDay);
  } catch (error) {
    console.error("Update day status error:", error);
    res.status(500).json({ error: "Failed to update day status" });
  }
});

router.delete("/api/plans/days/:dayId", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const { dayId } = req.params;
    const userId = getUserId(req);
    const deleted = await storage.deletePlanDay(dayId, userId);
    if (!deleted) {
      return res.status(404).json({ error: "Plan day not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Delete plan day error:", error);
    res.status(500).json({ error: "Failed to delete plan day" });
  }
});

export default router;

import { Router } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { updatePlanDaySchema, importPlanRequestSchema, schedulePlanRequestSchema } from "@shared/schema";
import { getUserId, AuthenticatedRequest } from "../types";
import { importPlanFromCSV, createSamplePlan, updatePlanDayWithCleanup } from "../services/planService";
import { rateLimiter , handleError } from "../routeUtils";

const router = Router();

router.get("/api/plans", isAuthenticated, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = getUserId(req);
    const plans = await storage.listTrainingPlans(userId);
    res.json(plans);
  } catch (error) {
    return handleError(res, error, "List plans error:", "Failed to list training plans", 500);
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
    return handleError(res, error, "Get plan error:", "Failed to get training plan", 500);
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
  } catch (error: any) {
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
    return handleError(res, error, "Create sample plan error:", "Failed to create sample plan", 500);
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
    return handleError(res, error, "Update day error:", "Failed to update day", 500);
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
    return handleError(res, error, "Update day error:", "Failed to update day", 500);
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
    return handleError(res, error, "Rename plan error:", "Failed to rename training plan", 500);
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
    return handleError(res, error, "Delete plan error:", "Failed to delete training plan", 500);
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
    return handleError(res, error, "Schedule plan error:", "Failed to schedule training plan", 500);
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
    return handleError(res, error, "Update day status error:", "Failed to update day status", 500);
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
    return handleError(res, error, "Delete plan day error:", "Failed to delete plan day", 500);
  }
});

export default router;

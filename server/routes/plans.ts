import { logger } from "../logger";
import { Router, Response, type Request } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { updatePlanDaySchema, importPlanRequestSchema, schedulePlanRequestSchema, type UpdatePlanDay, type PlanDay } from "@shared/schema";
import { getUserId } from "../types";
import { importPlanFromCSV, createSamplePlan, updatePlanDayWithCleanup } from "../services/planService";
import { rateLimiter } from "../routeUtils";

const router = Router();

async function handlePlanDayUpdate(
  req: Request,
  res: Response,
  updateFn: (dayId: string, data: UpdatePlanDay, userId: string) => Promise<PlanDay | null | undefined>
) {
  try {
    const { dayId } = req.params;
    const userId = getUserId(req);

    const parseResult = updatePlanDaySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid update data", details: parseResult.error });
    }

    const updatedDay = await updateFn(dayId, parseResult.data, userId);
    if (!updatedDay) {
      return res.status(404).json({ error: "Day not found" });
    }

    res.json(updatedDay);
  } catch (error) {
    logger.error({ err: error }, "Update day error:");
    res.status(500).json({ error: "Failed to update day" });
  }
}

async function handleGetOrDeletePlan(
  req: Request,
  res: Response,
  actionFn: (id: string, userId: string) => Promise<any>,
  successMsg?: string,
  errorPrefix = "Get"
) {
  try {
    const userId = getUserId(req);
    const result = await actionFn(req.params.id, userId);
    if (!result) {
      return res.status(404).json({ error: "Training plan not found" });
    }
    res.json(successMsg ? { success: true } : result);
  } catch (error) {
    logger.error({ err: error }, `${errorPrefix} plan error:`);
    res.status(500).json({ error: `Failed to ${errorPrefix.toLowerCase()} training plan` });
  }
}

router.get("/api/v1/plans", isAuthenticated, async (req: Request, res) => {
  try {
    const userId = getUserId(req);
    const plans = await storage.listTrainingPlans(userId);
    res.json(plans);
  } catch (error) {
    logger.error({ err: error }, "List plans error:");
    res.status(500).json({ error: "Failed to list training plans" });
  }
});

router.get("/api/v1/plans/:id", isAuthenticated, async (req: Request, res) => {
  return handleGetOrDeletePlan(req, res, storage.getTrainingPlan.bind(storage), undefined, "Get");
});

router.post("/api/v1/plans/import", isAuthenticated, rateLimiter("planImport", 5), async (req: Request, res) => {
  try {
    const parseResult = importPlanRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "CSV content is required" });
    }
    const { csvContent, fileName, planName } = parseResult.data;

    const userId = getUserId(req);
    const fullPlan = await importPlanFromCSV(csvContent, userId, { fileName, planName });
    res.json(fullPlan);
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === "No valid rows found in CSV" || error.message === "No valid week numbers found in CSV")) {
      return res.status(400).json({ error: error.message });
    }
    logger.error({ err: error }, "Import plan error:");
    res.status(500).json({ error: "Failed to import training plan" });
  }
});

router.post("/api/v1/plans/sample", isAuthenticated, rateLimiter("planSample", 5), async (req: Request, res) => {
  try {
    const userId = getUserId(req);
    const fullPlan = await createSamplePlan(userId);
    res.json(fullPlan);
  } catch (error) {
    logger.error({ err: error }, "Create sample plan error:");
    res.status(500).json({ error: "Failed to create sample plan" });
  }
});

router.patch("/api/v1/plans/:planId/days/:dayId", isAuthenticated, async (req: Request, res) => {
  return handlePlanDayUpdate(req, res, (dayId, data, userId) => storage.updatePlanDay(dayId, data, userId));
});

router.patch("/api/v1/plans/days/:dayId", isAuthenticated, async (req: Request, res) => {
  return handlePlanDayUpdate(req, res, updatePlanDayWithCleanup);
});

router.patch("/api/v1/plans/:id", isAuthenticated, async (req: Request, res) => {
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
    logger.error({ err: error }, "Rename plan error:");
    res.status(500).json({ error: "Failed to rename training plan" });
  }
});

router.delete("/api/v1/plans/:id", isAuthenticated, async (req: Request, res) => {
  return handleGetOrDeletePlan(req, res, storage.deleteTrainingPlan.bind(storage), "true", "Delete");
});

router.post("/api/v1/plans/:planId/schedule", isAuthenticated, rateLimiter("planSchedule", 10), async (req: Request, res: Response) => {
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
    logger.error({ err: error }, "Schedule plan error:");
    res.status(500).json({ error: "Failed to schedule training plan" });
  }
});

router.patch("/api/v1/plans/days/:dayId/status", isAuthenticated, async (req: Request, res) => {
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
    logger.error({ err: error }, "Update day status error:");
    res.status(500).json({ error: "Failed to update day status" });
  }
});

router.delete("/api/v1/plans/days/:dayId", isAuthenticated, async (req: Request, res) => {
  try {
    const { dayId } = req.params;
    const userId = getUserId(req);
    const deleted = await storage.deletePlanDay(dayId, userId);
    if (!deleted) {
      return res.status(404).json({ error: "Plan day not found" });
    }
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "Delete plan day error:");
    res.status(500).json({ error: "Failed to delete plan day" });
  }
});

export default router;

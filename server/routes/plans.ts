import { logger } from "../logger";
import { z } from "zod";
import { Router, Response, type Request } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { updatePlanDaySchema, importPlanRequestSchema, schedulePlanRequestSchema, updateTrainingPlanGoalSchema, workoutStatusEnum, dateStringSchema, type UpdatePlanDay, type PlanDay } from "@shared/schema";
import { getUserId } from "../types";
import { importPlanFromCSV, createSamplePlan, updatePlanDayWithCleanup } from "../services/planService";
import { rateLimiter } from "../routeUtils";
import { triggerAutoCoach } from "../services/coachService";

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
    (req.log || logger).error({ err: error }, "Update day error:");
    res.status(500).json({ error: "Failed to update day" });
  }
}

async function handleGetOrDeletePlan(
  req: Request,
  res: Response,
  actionFn: (id: string, userId: string) => Promise<Record<string, unknown> | null | undefined>,
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
    (req.log || logger).error({ err: error }, `${errorPrefix} plan error:`);
    res.status(500).json({ error: `Failed to ${errorPrefix.toLowerCase()} training plan` });
  }
}

router.get("/api/v1/plans", isAuthenticated, async (req: Request, res) => {
  try {
    const userId = getUserId(req);
    const plans = await storage.listTrainingPlans(userId);
    res.json(plans);
  } catch (error) {
    (req.log || logger).error({ err: error }, "List plans error:");
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
    (req.log || logger).error({ err: error }, "Import plan error:");
    res.status(500).json({ error: "Failed to import training plan" });
  }
});

router.post("/api/v1/plans/sample", isAuthenticated, rateLimiter("planSample", 5), async (req: Request, res) => {
  try {
    const userId = getUserId(req);
    const fullPlan = await createSamplePlan(userId);
    res.json(fullPlan);
  } catch (error) {
    (req.log || logger).error({ err: error }, "Create sample plan error:");
    res.status(500).json({ error: "Failed to create sample plan" });
  }
});

router.patch("/api/v1/plans/:planId/days/:dayId", isAuthenticated, rateLimiter("planDayUpdate", 20), async (req: Request, res) => {
  return handlePlanDayUpdate(req, res, (dayId, data, userId) => storage.updatePlanDay(dayId, data, userId));
});

router.patch("/api/v1/plans/days/:dayId", isAuthenticated, rateLimiter("planDayUpdate", 20), async (req: Request, res) => {
  return handlePlanDayUpdate(req, res, updatePlanDayWithCleanup);
});

const renameTrainingPlanSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255, "Name must be 255 characters or less"),
});

router.patch("/api/v1/plans/:id", isAuthenticated, rateLimiter("planUpdate", 20), async (req: Request, res) => {
  try {
    const userId = getUserId(req);
    const parseResult = renameTrainingPlanSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0].message });
    }
    const updated = await storage.renameTrainingPlan(req.params.id, parseResult.data.name, userId);
    if (!updated) {
      return res.status(404).json({ error: "Training plan not found" });
    }
    res.json(updated);
  } catch (error) {
    (req.log || logger).error({ err: error }, "Rename plan error:");
    res.status(500).json({ error: "Failed to rename training plan" });
  }
});

router.patch("/api/v1/plans/:id/goal", isAuthenticated, rateLimiter("planUpdate", 20), async (req: Request, res) => {
  try {
    const userId = getUserId(req);
    const parseResult = updateTrainingPlanGoalSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid goal data", details: parseResult.error });
    }
    const updated = await storage.updateTrainingPlanGoal(req.params.id, parseResult.data.goal, userId);
    if (!updated) {
      return res.status(404).json({ error: "Training plan not found" });
    }
    res.json(updated);
  } catch (error) {
    (req.log || logger).error({ err: error }, "Update plan goal error:");
    res.status(500).json({ error: "Failed to update plan goal" });
  }
});

router.delete("/api/v1/plans/:id", isAuthenticated, rateLimiter("planDelete", 10), async (req: Request, res) => {
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
    (req.log || logger).error({ err: error }, "Schedule plan error:");
    res.status(500).json({ error: "Failed to schedule training plan" });
  }
});

const patchDayStatusSchema = z.object({
  status: z.enum(workoutStatusEnum).optional(),
  scheduledDate: dateStringSchema.nullable().optional(),
});

router.patch("/api/v1/plans/days/:dayId/status", isAuthenticated, rateLimiter("planDayStatus", 20), async (req: Request, res) => {
  try {
    const { dayId } = req.params;
    const userId = getUserId(req);

    const parseResult = patchDayStatusSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid status or date", details: parseResult.error });
    }
    const { status, scheduledDate } = parseResult.data;

    const updates: Record<string, string | null> = {};
    if (status) updates.status = status;
    if (scheduledDate !== undefined) updates.scheduledDate = scheduledDate ?? null;

    if (status && status !== "completed") {
      await storage.deleteWorkoutLogByPlanDayId(dayId, userId);
    }

    const updatedDay = await storage.updatePlanDay(dayId, updates, userId);
    if (!updatedDay) {
      return res.status(404).json({ error: "Day not found" });
    }

    res.json(updatedDay);

    // Fire-and-forget: auto-coach adjusts upcoming plan days after a session is completed
    if (status === "completed") {
      triggerAutoCoach(userId).catch(() => {});
    }
  } catch (error) {
    (req.log || logger).error({ err: error }, "Update day status error:");
    res.status(500).json({ error: "Failed to update day status" });
  }
});

router.delete("/api/v1/plans/days/:dayId", isAuthenticated, rateLimiter("planDayDelete", 10), async (req: Request, res) => {
  try {
    const { dayId } = req.params;
    const userId = getUserId(req);
    const deleted = await storage.deletePlanDay(dayId, userId);
    if (!deleted) {
      return res.status(404).json({ error: "Plan day not found" });
    }
    res.json({ success: true });
  } catch (error) {
    (req.log || logger).error({ err: error }, "Delete plan day error:");
    res.status(500).json({ error: "Failed to delete plan day" });
  }
});

export default router;

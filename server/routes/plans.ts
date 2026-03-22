import { logger } from "../logger";
import { z } from "zod";
import { Router, type Response, type Request as ExpressRequest } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { updatePlanDaySchema, importPlanRequestSchema, schedulePlanRequestSchema, updateTrainingPlanGoalSchema, workoutStatusEnum, dateStringSchema, type UpdatePlanDay, type PlanDay, type UpdateTrainingPlanGoal } from "@shared/schema";
import { getUserId } from "../types";
import { importPlanFromCSV, createSamplePlan, updatePlanDayWithCleanup, updatePlanDayStatus } from "../services/planService";
import { rateLimiter, asyncHandler } from "../routeUtils";

const router = Router();

async function handlePlanDayUpdate<P extends Record<string, string> & { dayId: string }>(
  req: ExpressRequest<P, unknown, UpdatePlanDay>,
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

async function handleGetOrDeletePlan<P extends Record<string, string>>(
  req: ExpressRequest<P>,
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

router.get("/api/v1/plans", isAuthenticated, asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const plans = await storage.listTrainingPlans(userId);
    res.json(plans);
  }));

router.get("/api/v1/plans/:id", isAuthenticated, async (req: ExpressRequest<{ id: string }>, res: Response) => {
  return handleGetOrDeletePlan(req, res, storage.getTrainingPlan.bind(storage), undefined, "Get");
});

router.post("/api/v1/plans/import", isAuthenticated, rateLimiter("planImport", 5), asyncHandler(async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof importPlanRequestSchema>>, res: Response) => {
    const parseResult = importPlanRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "CSV content is required" });
    }
    const { csvContent, fileName, planName } = parseResult.data;

    const userId = getUserId(req);
    const fullPlan = await importPlanFromCSV(csvContent, userId, { fileName, planName });
    res.json(fullPlan);
  }));

router.post("/api/v1/plans/sample", isAuthenticated, rateLimiter("planSample", 5), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const fullPlan = await createSamplePlan(userId);
    res.json(fullPlan);
  }));

router.patch("/api/v1/plans/:planId/days/:dayId", isAuthenticated, rateLimiter("planDayUpdate", 20), async (req: ExpressRequest<{ planId: string; dayId: string }, unknown, UpdatePlanDay>, res: Response) => {
  return handlePlanDayUpdate(req, res, (dayId, data, userId) => storage.updatePlanDay(dayId, data, userId));
});

router.patch("/api/v1/plans/days/:dayId", isAuthenticated, rateLimiter("planDayUpdate", 20), async (req: ExpressRequest<{ dayId: string }, unknown, UpdatePlanDay>, res: Response) => {
  return handlePlanDayUpdate(req, res, updatePlanDayWithCleanup);
});

const renameTrainingPlanSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255, "Name must be 255 characters or less"),
});

router.patch("/api/v1/plans/:id", isAuthenticated, rateLimiter("planUpdate", 20), asyncHandler(async (req: ExpressRequest<{ id: string }, unknown, { name: string }>, res: Response) => {
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
  }));

router.patch("/api/v1/plans/:id/goal", isAuthenticated, rateLimiter("planUpdate", 20), asyncHandler(async (req: ExpressRequest<{ id: string }, unknown, UpdateTrainingPlanGoal>, res: Response) => {
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
  }));

router.delete("/api/v1/plans/:id", isAuthenticated, rateLimiter("planDelete", 10), async (req: ExpressRequest<{ id: string }>, res: Response) => {
  return handleGetOrDeletePlan(req, res, async (id, userId) => { await storage.deleteTrainingPlan(id, userId); return { success: true }; }, "true", "Delete");
});

router.post("/api/v1/plans/:planId/schedule", isAuthenticated, rateLimiter("planSchedule", 10), asyncHandler(async (req: ExpressRequest<{ planId: string }, unknown, z.infer<typeof schedulePlanRequestSchema>>, res: Response) => {
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
  }));

const patchDayStatusSchema = z.object({
  status: z.enum(workoutStatusEnum).optional(),
  scheduledDate: dateStringSchema.nullable().optional(),
});

router.patch("/api/v1/plans/days/:dayId/status", isAuthenticated, rateLimiter("planDayStatus", 20), asyncHandler(async (req: ExpressRequest<{ dayId: string }, unknown, { status?: "planned" | "completed" | "skipped"; scheduledDate?: string | null }>, res: Response) => {
    const { dayId } = req.params;
    const userId = getUserId(req);

    const parseResult = patchDayStatusSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid status or date", details: parseResult.error });
    }
    const { status, scheduledDate } = parseResult.data;

    const updatedDay = await updatePlanDayStatus(dayId, { status, scheduledDate }, userId);
    if (!updatedDay) {
      return res.status(404).json({ error: "Day not found" });
    }

    res.json(updatedDay);
  }));

router.delete("/api/v1/plans/days/:dayId", isAuthenticated, rateLimiter("planDayDelete", 10), asyncHandler(async (req: ExpressRequest<{ dayId: string }>, res: Response) => {
    const { dayId } = req.params;
    const userId = getUserId(req);
    const deleted = await storage.deletePlanDay(dayId, userId);
    if (!deleted) {
      return res.status(404).json({ error: "Plan day not found" });
    }
    res.json({ success: true });
  }));

export default router;

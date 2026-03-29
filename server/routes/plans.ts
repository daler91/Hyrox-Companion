import { z } from "zod";
import { Router, type Response, type Request as ExpressRequest } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { updatePlanDaySchema, importPlanRequestSchema, schedulePlanRequestSchema, updateTrainingPlanGoalSchema, workoutStatusEnum, dateStringSchema, generatePlanInputSchema, type UpdatePlanDay, type PlanDay, type UpdateTrainingPlanGoal } from "@shared/schema";
import { getUserId } from "../types";
import { importPlanFromCSV, createSamplePlan, updatePlanDayWithCleanup, updatePlanDayStatus } from "../services/planService";
import { generatePlan } from "../services/planGenerationService";
import { rateLimiter, asyncHandler, validateBody } from "../routeUtils";
import { logger } from "../logger";

const router = Router();

const handlePlanDayUpdate = (updateFn: (dayId: string, data: UpdatePlanDay, userId: string) => Promise<PlanDay | null | undefined>) => [
  validateBody(updatePlanDaySchema),
  asyncHandler(async (
    req: ExpressRequest<{ dayId: string } | { planId: string; dayId: string }, unknown, UpdatePlanDay>,
    res: Response
  ) => {
    const { dayId } = req.params;
    const userId = getUserId(req);
    const updatedDay = await updateFn(dayId, req.body, userId);
  if (!updatedDay) {
    return res.status(404).json({ error: "Day not found", code: "NOT_FOUND" });
  }

  res.json(updatedDay);
  })
]

const handleGetOrDeletePlan = (
  actionFn: (id: string, userId: string) => Promise<Record<string, unknown> | null | undefined>,
  successMsg?: string,
) => asyncHandler(async (
  req: ExpressRequest<{ id: string }>,
  res: Response
) => {
  const userId = getUserId(req);
  const result = await actionFn(req.params.id, userId);
  if (!result) {
    return res.status(404).json({ error: "Training plan not found", code: "NOT_FOUND" });
  }
  res.json(successMsg ? { success: true } : result);
})

router.get("/api/v1/plans", isAuthenticated, asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const plans = await storage.listTrainingPlans(userId);
    res.json(plans);
  }));

router.get("/api/v1/plans/:id", isAuthenticated, handleGetOrDeletePlan(storage.getTrainingPlan.bind(storage)));

router.post("/api/v1/plans/import", isAuthenticated, rateLimiter("planImport", 5), asyncHandler(async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof importPlanRequestSchema>>, res: Response) => {
    const parseResult = importPlanRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "CSV content is required", code: "BAD_REQUEST" });
    }
    const { csvContent, fileName, planName } = parseResult.data;

    const userId = getUserId(req);
    try {
      const fullPlan = await importPlanFromCSV(csvContent, userId, { fileName, planName });
      res.json(fullPlan);
    } catch (error: unknown) {
      const log = req.log || logger;
      log.error({ err: error }, "Failed to import plan from CSV");
      return res.status(400).json({ error: "Failed to parse CSV content. Please ensure it follows the expected template format.", code: "INVALID_CSV" });
    }
  }));

router.post("/api/v1/plans/sample", isAuthenticated, rateLimiter("planSample", 5), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const fullPlan = await createSamplePlan(userId);
    res.json(fullPlan);
  }));

router.post("/api/v1/plans/generate", isAuthenticated, rateLimiter("planGenerate", 3), validateBody(generatePlanInputSchema), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    try {
      const fullPlan = await generatePlan(req.body, userId);
      res.json(fullPlan);
    } catch (error: unknown) {
      const log = req.log || logger;
      log.error({ err: error }, "Failed to generate AI training plan");
      return res.status(500).json({ error: "Failed to generate training plan. Please try again.", code: "GENERATION_FAILED" });
    }
  }));

router.patch("/api/v1/plans/:planId/days/:dayId", isAuthenticated, rateLimiter("planDayUpdate", 20), handlePlanDayUpdate((dayId, data, userId) => storage.updatePlanDay(dayId, data, userId)));

router.patch("/api/v1/plans/days/:dayId", isAuthenticated, rateLimiter("planDayUpdate", 20), handlePlanDayUpdate(updatePlanDayWithCleanup));

const renameTrainingPlanSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255, "Name must be 255 characters or less"),
});

router.patch("/api/v1/plans/:id", isAuthenticated, rateLimiter("planUpdate", 20), validateBody(renameTrainingPlanSchema), asyncHandler(async (req: ExpressRequest<{ id: string }, unknown, { name: string }>, res: Response) => {
    const userId = getUserId(req);
    const updated = await storage.renameTrainingPlan(req.params.id, req.body.name, userId);
    if (!updated) {
      return res.status(404).json({ error: "Training plan not found", code: "NOT_FOUND" });
    }
    res.json(updated);
  }));

router.patch("/api/v1/plans/:id/goal", isAuthenticated, rateLimiter("planUpdate", 20), asyncHandler(async (req: ExpressRequest<{ id: string }, unknown, UpdateTrainingPlanGoal>, res: Response) => {
    const userId = getUserId(req);
    const parseResult = updateTrainingPlanGoalSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid goal data", code: "VALIDATION_ERROR", details: parseResult.error });
    }
    const updated = await storage.updateTrainingPlanGoal(req.params.id, parseResult.data.goal, userId);
    if (!updated) {
      return res.status(404).json({ error: "Training plan not found", code: "NOT_FOUND" });
    }
    res.json(updated);
  }));

router.delete("/api/v1/plans/:id", isAuthenticated, rateLimiter("planDelete", 10), handleGetOrDeletePlan(async (id, userId) => { await storage.deleteTrainingPlan(id, userId); return { success: true }; }, "true"));

router.post("/api/v1/plans/:planId/schedule", isAuthenticated, rateLimiter("planSchedule", 10), asyncHandler(async (req: ExpressRequest<{ planId: string }, unknown, z.infer<typeof schedulePlanRequestSchema>>, res: Response) => {
    const parseResult = schedulePlanRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid start date format. Must be YYYY-MM-DD", code: "BAD_REQUEST" });
    }
    const { startDate } = parseResult.data;

    const userId = getUserId(req);
    const { planId } = req.params;

    const success = await storage.schedulePlan(planId, startDate, userId);
    if (!success) {
      return res.status(404).json({ error: "Training plan not found", code: "NOT_FOUND" });
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
      return res.status(400).json({ error: "Invalid status or date", code: "VALIDATION_ERROR", details: parseResult.error });
    }
    const { status, scheduledDate } = parseResult.data;

    const updatedDay = await updatePlanDayStatus(dayId, { status, scheduledDate }, userId);
    if (!updatedDay) {
      return res.status(404).json({ error: "Day not found", code: "NOT_FOUND" });
    }

    res.json(updatedDay);
  }));

router.delete("/api/v1/plans/days/:dayId", isAuthenticated, rateLimiter("planDayDelete", 10), asyncHandler(async (req: ExpressRequest<{ dayId: string }>, res: Response) => {
    const { dayId } = req.params;
    const userId = getUserId(req);
    const deleted = await storage.deletePlanDay(dayId, userId);
    if (!deleted) {
      return res.status(404).json({ error: "Plan day not found", code: "NOT_FOUND" });
    }
    res.json({ success: true });
  }));

export default router;

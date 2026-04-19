import { dateStringSchema, type GeneratePlanInput,generatePlanInputSchema, importPlanRequestSchema, type PlanDay, schedulePlanRequestSchema, type UpdatePlanDay, updatePlanDaySchema, type UpdateTrainingPlanGoal, updateTrainingPlanGoalSchema, workoutStatusEnum } from "@shared/schema";
import { type Request as ExpressRequest,type Response, Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../clerkAuth";
import { logger } from "../logger";
import { aiBudgetCheck } from "../middleware/aibudget";
import { protectedMutationGuards } from "../routeGuards";
import { asyncHandler, rateLimiter, validateBody } from "../routeUtils";
import { generatePlan } from "../services/planGenerationService";
import { createSamplePlan, importPlanFromCSV, updatePlanDayStatus,updatePlanDayWithCleanup } from "../services/planService";
import { storage } from "../storage";
import { getUserId } from "../types";

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
    const plans = await storage.plans.listTrainingPlans(userId);
    res.json(plans);
  }));

router.get("/api/v1/plans/:id", isAuthenticated, handleGetOrDeletePlan(storage.plans.getTrainingPlan.bind(storage)));

router.post("/api/v1/plans/import", ...protectedMutationGuards, rateLimiter("planImport", 5), validateBody(importPlanRequestSchema), asyncHandler(async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof importPlanRequestSchema>>, res: Response) => {
    const { csvContent, fileName, planName } = req.body;
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

router.post("/api/v1/plans/sample", ...protectedMutationGuards, rateLimiter("planSample", 5), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const fullPlan = await createSamplePlan(userId);
    res.json(fullPlan);
  }));

router.post("/api/v1/plans/generate", ...protectedMutationGuards, rateLimiter("planGenerate", 3), aiBudgetCheck, validateBody(generatePlanInputSchema), asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    try {
      const fullPlan = await generatePlan(req.body as GeneratePlanInput, userId);
      res.json(fullPlan);
    } catch (error: unknown) {
      const log = req.log || logger;
      log.error({ err: error }, "Failed to generate AI training plan");
      return res.status(500).json({ error: "Failed to generate training plan. Please try again.", code: "GENERATION_FAILED" });
    }
  }));

router.patch("/api/v1/plans/:planId/days/:dayId", ...protectedMutationGuards, rateLimiter("planDayUpdate", 20), handlePlanDayUpdate((dayId, data, userId) => storage.plans.updatePlanDay(dayId, data, userId)));

router.patch("/api/v1/plans/days/:dayId", ...protectedMutationGuards, rateLimiter("planDayUpdate", 20), handlePlanDayUpdate(updatePlanDayWithCleanup));

const renameTrainingPlanSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255, "Name must be 255 characters or less"),
});

router.patch("/api/v1/plans/:id", ...protectedMutationGuards, rateLimiter("planUpdate", 20), validateBody(renameTrainingPlanSchema), asyncHandler(async (req: ExpressRequest<{ id: string }, unknown, { name: string }>, res: Response) => {
    const userId = getUserId(req);
    const updated = await storage.plans.renameTrainingPlan(req.params.id, req.body.name, userId);
    if (!updated) {
      return res.status(404).json({ error: "Training plan not found", code: "NOT_FOUND" });
    }
    res.json(updated);
  }));

router.patch("/api/v1/plans/:id/goal", ...protectedMutationGuards, rateLimiter("planUpdate", 20), validateBody(updateTrainingPlanGoalSchema), asyncHandler(async (req: ExpressRequest<{ id: string }, unknown, UpdateTrainingPlanGoal>, res: Response) => {
    const userId = getUserId(req);
    const updated = await storage.plans.updateTrainingPlanGoal(req.params.id, req.body.goal, userId);
    if (!updated) {
      return res.status(404).json({ error: "Training plan not found", code: "NOT_FOUND" });
    }
    res.json(updated);
  }));

router.delete("/api/v1/plans/:id", ...protectedMutationGuards, rateLimiter("planDelete", 10), handleGetOrDeletePlan(async (id, userId) => { const deleted = await storage.plans.deleteTrainingPlan(id, userId); return deleted ? { success: true } : null; }, "true"));

router.post("/api/v1/plans/:planId/schedule", ...protectedMutationGuards, rateLimiter("planSchedule", 10), validateBody(schedulePlanRequestSchema), asyncHandler(async (req: ExpressRequest<{ planId: string }, unknown, z.infer<typeof schedulePlanRequestSchema>>, res: Response) => {
    const { startDate } = req.body;
    const userId = getUserId(req);
    const { planId } = req.params;

    const success = await storage.plans.schedulePlan(planId, startDate, userId);
    if (!success) {
      return res.status(404).json({ error: "Training plan not found", code: "NOT_FOUND" });
    }

    res.json({ success: true });
  }));

const patchDayStatusSchema = z.object({
  status: z.enum(workoutStatusEnum).optional(),
  scheduledDate: dateStringSchema.nullable().optional(),
});

router.patch("/api/v1/plans/days/:dayId/status", ...protectedMutationGuards, rateLimiter("planDayStatus", 20), validateBody(patchDayStatusSchema), asyncHandler(async (req: ExpressRequest<{ dayId: string }, unknown, z.infer<typeof patchDayStatusSchema>>, res: Response) => {
    const { dayId } = req.params;
    const userId = getUserId(req);
    const { status, scheduledDate } = req.body;

    const updatedDay = await updatePlanDayStatus(dayId, { status, scheduledDate }, userId);
    if (!updatedDay) {
      return res.status(404).json({ error: "Day not found", code: "NOT_FOUND" });
    }

    res.json(updatedDay);
  }));

router.delete("/api/v1/plans/days/:dayId", ...protectedMutationGuards, rateLimiter("planDayDelete", 10), asyncHandler(async (req: ExpressRequest<{ dayId: string }>, res: Response) => {
    const { dayId } = req.params;
    const userId = getUserId(req);
    const deleted = await storage.plans.deletePlanDay(dayId, userId);
    if (!deleted) {
      return res.status(404).json({ error: "Plan day not found", code: "NOT_FOUND" });
    }
    res.json({ success: true });
  }));

// -----------------------------------------------------------------------------
// Plan-day exercise-set CRUD — used by the v2 workout detail dialog when a
// planned entry is open. Mirrors the workout-log routes in server/routes/workouts.ts
// but writes to exercise_sets owned by a planDay. Ownership is enforced per-row
// through storage.workouts.ownsPlanDay + getExerciseSetOwned.
// -----------------------------------------------------------------------------

const PLAN_DAY_NOT_FOUND = "Plan day not found";
const PLAN_DAY_SET_NOT_FOUND = "Exercise set not found";

const patchPlanDaySetSchema = z.object({
  exerciseName: z.string().min(1).max(255).optional(),
  customLabel: z.string().max(255).nullable().optional(),
  category: z.string().max(50).optional(),
  setNumber: z.number().int().min(1).max(100).optional(),
  reps: z.number().int().min(0).max(10_000).nullable().optional(),
  weight: z.number().min(0).max(2_000).nullable().optional(),
  distance: z.number().min(0).max(1_000_000).nullable().optional(),
  time: z.number().min(0).max(86_400).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  sortOrder: z.number().int().nullable().optional(),
});
type PatchPlanDaySetPayload = z.infer<typeof patchPlanDaySetSchema>;

const addPlanDaySetSchema = z.object({
  exerciseName: z.string().min(1).max(255),
  customLabel: z.string().max(255).nullable().optional(),
  category: z.string().max(50),
  setNumber: z.number().int().min(1).max(100).default(1),
  reps: z.number().int().min(0).max(10_000).nullable().optional(),
  weight: z.number().min(0).max(2_000).nullable().optional(),
  distance: z.number().min(0).max(1_000_000).nullable().optional(),
  time: z.number().min(0).max(86_400).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  confidence: z.number().int().min(0).max(100).nullable().optional(),
});
type AddPlanDaySetPayload = z.infer<typeof addPlanDaySetSchema>;

router.get(
  "/api/v1/plans/days/:dayId/sets",
  isAuthenticated,
  rateLimiter("planDaySet", 60),
  asyncHandler(async (req: ExpressRequest<{ dayId: string }>, res: Response) => {
    const userId = getUserId(req);
    const sets = await storage.workouts.getExerciseSetsByPlanDay(req.params.dayId, userId);
    res.json(sets);
  }),
);

router.post(
  "/api/v1/plans/days/:dayId/sets",
  ...protectedMutationGuards,
  rateLimiter("planDaySet", 60),
  validateBody(addPlanDaySetSchema),
  asyncHandler(async (req: ExpressRequest<{ dayId: string }, Record<string, never>, AddPlanDaySetPayload>, res: Response) => {
    const userId = getUserId(req);
    const created = await storage.workouts.addExerciseSetToPlanDay(req.params.dayId, req.body, userId);
    if (!created) {
      return res.status(404).json({ error: PLAN_DAY_NOT_FOUND, code: "NOT_FOUND" });
    }
    res.status(201).json(created);
  }),
);

router.patch(
  "/api/v1/plans/days/:dayId/sets/:setId",
  ...protectedMutationGuards,
  rateLimiter("planDaySet", 120),
  validateBody(patchPlanDaySetSchema),
  asyncHandler(async (req: ExpressRequest<{ dayId: string; setId: string }, Record<string, never>, PatchPlanDaySetPayload>, res: Response) => {
    const userId = getUserId(req);
    const updated = await storage.workouts.updateExerciseSetForPlanDay(
      req.params.dayId,
      req.params.setId,
      req.body,
      userId,
    );
    if (!updated) {
      return res.status(404).json({ error: PLAN_DAY_SET_NOT_FOUND, code: "NOT_FOUND" });
    }
    res.json(updated);
  }),
);

router.delete(
  "/api/v1/plans/days/:dayId/sets/:setId",
  ...protectedMutationGuards,
  rateLimiter("planDaySet", 60),
  asyncHandler(async (req: ExpressRequest<{ dayId: string; setId: string }>, res: Response) => {
    const userId = getUserId(req);
    const deleted = await storage.workouts.deleteExerciseSetForPlanDay(
      req.params.dayId,
      req.params.setId,
      userId,
    );
    if (!deleted) {
      return res.status(404).json({ error: PLAN_DAY_SET_NOT_FOUND, code: "NOT_FOUND" });
    }
    res.json({ success: true });
  }),
);

export default router;

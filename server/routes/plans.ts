import { type AddExerciseSetBody, addExerciseSetBodySchema, dateStringSchema, type GeneratePlanInput,generatePlanInputSchema, importPlanRequestSchema, parseExercisesFromImageRequestSchema, type PatchExerciseSetBody,patchExerciseSetBodySchema, schedulePlanRequestSchema, structureBlocksPayloadSchema, type UpdatePlanDay, updatePlanDaySchema, type UpdateTrainingPlanGoal, updateTrainingPlanGoalSchema, workoutStatusEnum } from "@shared/schema";
import { type Request as ExpressRequest,type Response, Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../clerkAuth";
import { AppError, classifyAiError, ErrorCode } from "../errors";
import { reqLogger } from "../logger";
import { asyncHandler, rateLimiter, sendNotFound, validateBody } from "../routeUtils";
import { regenerateCoachNoteForPlanDay } from "../services/coachService";
import { createPendingPlan } from "../services/planGenerationService";
import { createSamplePlan, importPlanFromCSV, updatePlanDayStatus,updatePlanDayWithCleanup } from "../services/planService";
import { sendJobNoRetry } from "../queue";
import { incrementStructuredExerciseCounter } from "../services/structuredExerciseHealth";
import { deriveMissingPlanDaySetsFromStructure, reparsePlanDay, reparsePlanDayFromImage, replacePlanDayStructure } from "../services/workoutService";
import { storage } from "../storage";
import { getUserId } from "../types";
import { createUpdatePlanDayUseCase } from "../usecases/plans/updatePlanDay.usecase";
import { createMutateExerciseSetUseCase } from "../usecases/workouts/mutateExerciseSet.usecase";
import { protectedDelete, protectedPatch, protectedPost } from "./_helpers/protectedRouteBuilder";

const router = Router();

const planDayStructureBodySchema = z.object({
  structureBlocks: structureBlocksPayloadSchema.default([]),
});

const planDayReparseBodySchema = z.object({
  mainWorkout: z.string().nullable().optional(),
  accessory: z.string().nullable().optional(),
}).strict();

function sendParseWriteThroughResponse(
  res: Response,
  ownerType: "plan_day",
  source: "voice" | "photo",
  result: { exercises: unknown[]; setCount: number; rejectedCount: number; rejectionReasons: string[] } | null,
): Response {
  if (!result || result.setCount === 0) {
    void incrementStructuredExerciseCounter(ownerType, source, source === "voice" ? "parse_text_failed" : "parse_photo_failed").catch(() => undefined);
    return res.status(422).json({ error: "Parsing did not produce persisted exercise sets.", code: "PARSE_WRITE_THROUGH_REQUIRED" });
  }
  void incrementStructuredExerciseCounter(ownerType, source, source === "voice" ? "parse_text_succeeded" : "parse_photo_succeeded").catch(() => undefined);
  return res.json({
    exercises: result.exercises,
    saved: true,
    setCount: result.setCount,
    rejectedCount: result.rejectedCount,
    rejectionReasons: result.rejectionReasons,
  });
}



function isLikelyAiProviderFailure(error: unknown): boolean {
  let raw = "";
  if (error instanceof Error) {
    raw = error.message;
  } else if (typeof error === "string") {
    raw = error;
  } else if (error != null) {
    try {
      raw = JSON.stringify(error);
    } catch {
      raw = "";
    }
  }
  const lower = raw.toLowerCase();
  return /gemini|google\.?genai|\bai\b|quota|rate.?limit|resource.?exhausted|unavailable|502|503|504|deadline|timeout|overloaded|upstream/.test(lower);
}

function hasStatusAndCode(error: unknown): error is { status: number; code: string; message?: string } {
  if (!error || typeof error !== "object") return false;
  const rec = error as Record<string, unknown>;
  return typeof rec.status === "number" && typeof rec.code === "string";
}

function sendPlanDayReparseError(
  req: ExpressRequest<{ dayId: string }>,
  res: Response,
  error: unknown,
  userId: string,
  mode: "text" | "photo",
): Response {
  if (error instanceof AppError) {
    reqLogger(req).error({ err: error, dayId: req.params.dayId, userId, code: error.code }, `Plan-day ${mode} reparse failed`);
    const isUpstreamUnavailable = error.code === ErrorCode.AI_UNAVAILABLE;
    return res.status(isUpstreamUnavailable ? 502 : error.status).json({
      error: error.message,
      code: isUpstreamUnavailable ? "AI_UPSTREAM_FAILURE" : error.code,
    });
  }

  if (!isLikelyAiProviderFailure(error)) {
    if (hasStatusAndCode(error)) {
      reqLogger(req).error({ err: error, dayId: req.params.dayId, userId, code: error.code }, `Plan-day ${mode} reparse failed with structured non-AI error`);
      return res.status(error.status).json({ error: error.message ?? "Failed to parse plan day. Please try again.", code: error.code });
    }
    reqLogger(req).error({ err: error, dayId: req.params.dayId, userId }, `Plan-day ${mode} reparse failed due to non-AI error`);
    return res.status(500).json({ error: "Failed to parse plan day. Please try again.", code: "INTERNAL_ERROR" });
  }

  const classified = classifyAiError(error);
  reqLogger(req).error(
    { err: error, dayId: req.params.dayId, userId, code: classified.code },
    `Plan-day ${mode} reparse failed`,
  );
  const isUpstreamUnavailable = classified.code === ErrorCode.AI_UNAVAILABLE;
  return res.status(isUpstreamUnavailable ? 502 : classified.status).json({
    error: classified.message,
    code: isUpstreamUnavailable ? "AI_UPSTREAM_FAILURE" : classified.code,
  });
}

function sendPlanGenerationError(
  req: ExpressRequest,
  res: Response,
  error: unknown,
  userId: string,
): Response {
  if (error instanceof AppError) {
    reqLogger(req).error({ err: error, userId, code: error.code }, "Failed to generate AI training plan");
    return res.status(error.status).json({ error: error.message, code: error.code });
  }

  if (hasStatusAndCode(error) && !isLikelyAiProviderFailure(error)) {
    reqLogger(req).error({ err: error, userId, code: error.code }, "Failed to generate AI training plan with structured non-AI error");
    return res.status(error.status).json({
      error: error.message ?? "Failed to generate training plan. Please try again.",
      code: error.code,
    });
  }

  if (isLikelyAiProviderFailure(error)) {
    const classified = classifyAiError(error);
    reqLogger(req).error({ err: error, userId, code: classified.code }, "Failed to generate AI training plan");
    return res.status(classified.status).json({
      error: classified.message,
      code: classified.code,
    });
  }

  reqLogger(req).error({ err: error, userId }, "Failed to generate AI training plan");
  return res.status(500).json({ error: "Failed to generate training plan. Please try again.", code: "GENERATION_FAILED" });
}

const updateStoredPlanDay = createUpdatePlanDayUseCase({
  updatePlanDay: (dayId, data, userId) => storage.plans.updatePlanDay(dayId, data, userId),
});

const planDaySetUseCase = createMutateExerciseSetUseCase({
  updateSet: (owner, setId, body, userId) => storage.workouts.mutateExerciseSetUpdate(owner, setId, body, userId),
  addSet: (owner, body, userId) => storage.workouts.mutateExerciseSetAdd(owner, body, userId),
  deleteSet: (owner, setId, userId) => storage.workouts.mutateExerciseSetDelete(owner, setId, userId),
});

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
    return sendNotFound(res, "Training plan not found");
  }
  res.json(successMsg ? { success: true } : result);
})

router.get("/api/v1/plans", isAuthenticated, asyncHandler(async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const plans = await storage.plans.listTrainingPlans(userId);
    res.json(plans);
  }));

router.get("/api/v1/plans/:id", isAuthenticated, handleGetOrDeletePlan(storage.plans.getTrainingPlan.bind(storage)));

protectedPost(router, "/api/v1/plans/import", { limiter: rateLimiter("planImport", 5), middleware: [validateBody(importPlanRequestSchema)] }, async (req: ExpressRequest<Record<string, never>, unknown, z.infer<typeof importPlanRequestSchema>>, res: Response) => {
    const { csvContent, fileName, planName } = req.body;
    const userId = getUserId(req);
    try {
      const fullPlan = await importPlanFromCSV(csvContent, userId, { fileName, planName });
      res.json(fullPlan);
    } catch (error: unknown) {
      reqLogger(req).error({ err: error }, "Failed to import plan from CSV");
      return res.status(400).json({ error: "Failed to parse CSV content. Please ensure it follows the expected template format.", code: "INVALID_CSV" });
    }
  });

protectedPost(router, "/api/v1/plans/sample", { limiter: rateLimiter("planSample", 5) }, async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const fullPlan = await createSamplePlan(userId);
    res.json(fullPlan);
  });

protectedPost(router, "/api/v1/plans/generate", { limiter: rateLimiter("planGenerate", 3), aiConsent: true, aiBudget: true, validation: [validateBody(generatePlanInputSchema)] }, async (req: ExpressRequest, res: Response) => {
    const userId = getUserId(req);
    const stub = await createPendingPlan(req.body as GeneratePlanInput, userId);
    await sendJobNoRetry("plan-generation", { planId: stub.id, userId, input: req.body });
    return res.status(202).json(stub);
  });

router.get("/api/v1/plans/:id/generation-status", isAuthenticated, rateLimiter("planStatus", 60), asyncHandler(async (req: ExpressRequest<{ id: string }>, res: Response) => {
  const userId = getUserId(req);
  const plan = await storage.plans.getTrainingPlan(req.params.id, userId);
  if (!plan) return sendNotFound(res, "Training plan not found");
  return res.json({
    planId: plan.id,
    generationStatus: plan.generationStatus,
    ...(plan.generationError ? { error: plan.generationError } : {}),
  });
}));

protectedPatch(router, "/api/v1/plans/:planId/days/:dayId", { limiter: rateLimiter("planDayUpdate", 20), middleware: [validateBody(updatePlanDaySchema)] }, async (req: ExpressRequest<{ planId: string; dayId: string }, unknown, UpdatePlanDay>, res: Response) => {
  const userId = getUserId(req);
  const updatedDay = await updateStoredPlanDay({ dayId: req.params.dayId, data: req.body, userId });
  if (!updatedDay) return sendNotFound(res, "Day not found");
  res.json(updatedDay);
});

protectedPatch(router, "/api/v1/plans/days/:dayId", { limiter: rateLimiter("planDayUpdate", 20), middleware: [validateBody(updatePlanDaySchema)] }, async (req: ExpressRequest<{ dayId: string }, unknown, UpdatePlanDay>, res: Response) => {
  const userId = getUserId(req);
  const updatedDay = await updatePlanDayWithCleanup(req.params.dayId, req.body, userId);
  if (!updatedDay) return sendNotFound(res, "Day not found");
  res.json(updatedDay);
});

const renameTrainingPlanSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255, "Name must be 255 characters or less"),
});

protectedPatch(router, "/api/v1/plans/:id", { limiter: rateLimiter("planUpdate", 20), middleware: [validateBody(renameTrainingPlanSchema)] }, async (req: ExpressRequest<{ id: string }, unknown, { name: string }>, res: Response) => {
    const userId = getUserId(req);
    const updated = await storage.plans.renameTrainingPlan(req.params.id, req.body.name, userId);
    if (!updated) {
      return sendNotFound(res, "Training plan not found");
    }
    res.json(updated);
  });

protectedPatch(router, "/api/v1/plans/:id/goal", { limiter: rateLimiter("planUpdate", 20), middleware: [validateBody(updateTrainingPlanGoalSchema)] }, async (req: ExpressRequest<{ id: string }, unknown, UpdateTrainingPlanGoal>, res: Response) => {
    const userId = getUserId(req);
    const updated = await storage.plans.updateTrainingPlanGoal(req.params.id, req.body.goal, userId);
    if (!updated) {
      return sendNotFound(res, "Training plan not found");
    }
    res.json(updated);
  });

protectedDelete(router, "/api/v1/plans/:id", { limiter: rateLimiter("planDelete", 10) }, handleGetOrDeletePlan(async (id, userId) => { const deleted = await storage.plans.deleteTrainingPlan(id, userId); return deleted ? { success: true } : null; }, "true"));

protectedPost(router, "/api/v1/plans/:planId/schedule", { limiter: rateLimiter("planSchedule", 10), middleware: [validateBody(schedulePlanRequestSchema)] }, async (req: ExpressRequest<{ planId: string }, unknown, z.infer<typeof schedulePlanRequestSchema>>, res: Response) => {
    const { startDate } = req.body;
    const userId = getUserId(req);
    const { planId } = req.params;

    const success = await storage.plans.schedulePlan(planId, startDate, userId);
    if (!success) {
      return sendNotFound(res, "Training plan not found");
    }

    res.json({ success: true });
  });

const patchDayStatusSchema = z.object({
  status: z.enum(workoutStatusEnum).optional(),
  scheduledDate: dateStringSchema.nullable().optional(),
});

protectedPatch(router, "/api/v1/plans/days/:dayId/status", { limiter: rateLimiter("planDayStatus", 20), middleware: [validateBody(patchDayStatusSchema)] }, async (req: ExpressRequest<{ dayId: string }, unknown, z.infer<typeof patchDayStatusSchema>>, res: Response) => {
    const { dayId } = req.params;
    const userId = getUserId(req);
    const { status, scheduledDate } = req.body;

    const updatedDay = await updatePlanDayStatus(dayId, { status, scheduledDate }, userId);
    if (!updatedDay) {
      return sendNotFound(res, "Day not found");
    }

    res.json(updatedDay);
  });

protectedDelete(router, "/api/v1/plans/days/:dayId", { limiter: rateLimiter("planDayDelete", 10) }, async (req: ExpressRequest<{ dayId: string }>, res: Response) => {
    const { dayId } = req.params;
    const userId = getUserId(req);
    const deleted = await storage.plans.deletePlanDay(dayId, userId);
    if (!deleted) {
      return sendNotFound(res, "Plan day not found");
    }
    res.json({ success: true });
  });

// -----------------------------------------------------------------------------
// Plan-day exercise-set CRUD — used by the v2 workout detail dialog when a
// planned entry is open. Mirrors the workout-log routes in server/routes/workouts.ts
// but writes to exercise_sets owned by a planDay. Ownership is enforced per-row
// through storage.workouts.ownsPlanDay + getExerciseSetOwned.
// -----------------------------------------------------------------------------

const PLAN_DAY_NOT_FOUND = "Plan day not found";
const PLAN_DAY_SET_NOT_FOUND = "Exercise set not found";

// Same body contracts as the workout-log set routes — shared in
// shared/schema/types.ts so the two URL families stay in lockstep.
type PatchPlanDaySetPayload = PatchExerciseSetBody;
type AddPlanDaySetPayload = AddExerciseSetBody;

router.get(
  "/api/v1/plans/days/:dayId/sets",
  isAuthenticated,
  rateLimiter("planDaySet", 60),
  asyncHandler(async (req: ExpressRequest<{ dayId: string }, unknown, unknown, { includeStructure?: string }>, res: Response) => {
    const userId = getUserId(req);
    let sets = await storage.workouts.getExerciseSetsByPlanDay(req.params.dayId, userId);
    if (sets === null) {
      return sendNotFound(res, PLAN_DAY_NOT_FOUND);
    }
    const includeStructure = req.query.includeStructure === "true";
    if (!includeStructure) {
      res.json(sets);
      return;
    }
    let structureBlocks = await storage.workouts.getWorkoutStructureByPlanDay(req.params.dayId, userId);
    if (structureBlocks === null) {
      return sendNotFound(res, PLAN_DAY_NOT_FOUND);
    }
    if (sets.length === 0 && structureBlocks.length > 0) {
      await deriveMissingPlanDaySetsFromStructure(req.params.dayId, userId);
      sets = (await storage.workouts.getExerciseSetsByPlanDay(req.params.dayId, userId)) ?? [];
      structureBlocks = await storage.workouts.getWorkoutStructureByPlanDay(req.params.dayId, userId) ?? [];
    }
    res.json({ exerciseSets: sets, structureBlocks });
  }),
);

protectedPatch(
  router,
  "/api/v1/plans/days/:dayId/structure",
  { limiter: rateLimiter("planDaySet", 60), middleware: [validateBody(planDayStructureBodySchema)] },
  async (req: ExpressRequest<{ dayId: string }, unknown, z.infer<typeof planDayStructureBodySchema>>, res: Response) => {
    const result = await replacePlanDayStructure(
      req.params.dayId,
      getUserId(req),
      req.body.structureBlocks ?? [],
    );
    if (!result) {
      return sendNotFound(res, PLAN_DAY_NOT_FOUND);
    }
    res.json(result);
  },
);

protectedPost(
  router,
  "/api/v1/plans/days/:dayId/sets",
  { limiter: rateLimiter("planDaySet", 60), middleware: [validateBody(addExerciseSetBodySchema)] },
  async (req: ExpressRequest<{ dayId: string }, Record<string, never>, AddPlanDaySetPayload>, res: Response) => {
    const userId = getUserId(req);
    const created = await planDaySetUseCase.addSet({ kind: "planDay", ownerId: req.params.dayId }, req.body, userId);
    if (!created) {
      return sendNotFound(res, PLAN_DAY_NOT_FOUND);
    }
    res.status(201).json(created);
  },
);

protectedPatch(
  router,
  "/api/v1/plans/days/:dayId/sets/:setId",
  { limiter: rateLimiter("planDaySet", 120), middleware: [validateBody(patchExerciseSetBodySchema)] },
  async (req: ExpressRequest<{ dayId: string; setId: string }, Record<string, never>, PatchPlanDaySetPayload>, res: Response) => {
    const userId = getUserId(req);
    const updated = await planDaySetUseCase.updateSet({ kind: "planDay", ownerId: req.params.dayId }, req.params.setId, req.body, userId);
    if (!updated) {
      return sendNotFound(res, PLAN_DAY_SET_NOT_FOUND);
    }
    res.json(updated);
  },
);

protectedDelete(
  router,
  "/api/v1/plans/days/:dayId/sets/:setId",
  { limiter: rateLimiter("planDaySet", 60) },
  async (req: ExpressRequest<{ dayId: string; setId: string }>, res: Response) => {
    const userId = getUserId(req);
    const deleted = await planDaySetUseCase.deleteSet({ kind: "planDay", ownerId: req.params.dayId }, req.params.setId, userId);
    if (!deleted) {
      return sendNotFound(res, PLAN_DAY_SET_NOT_FOUND);
    }
    res.json({ success: true });
  },
);

// Parse the plan day's mainWorkout/accessory free text into structured
// exercise_sets via the configured text provider. Replaces the plan day's existing prescribed
// rows so repeated Parse presses don't accumulate duplicates. Guarded by
// AI consent and budget checks are required because each call is an AI provider roundtrip.
protectedPost(
  router,
  "/api/v1/plans/days/:dayId/reparse",
  { limiter: rateLimiter("planDayReparse", 5), aiConsent: true, aiBudget: true, validation: [validateBody(planDayReparseBodySchema)] },
  async (
    req: ExpressRequest<{ dayId: string }, unknown, z.infer<typeof planDayReparseBodySchema>>,
    res: Response,
  ) => {
    const userId = getUserId(req);
    const [planDay, user] = await Promise.all([
      storage.plans.getPlanDay(req.params.dayId, userId),
      storage.users.getUser(userId),
    ]);
    if (!planDay) {
      return sendNotFound(res, PLAN_DAY_NOT_FOUND);
    }
    const unitPreferences = { weightUnit: user?.weightUnit || "kg", distanceUnit: user?.distanceUnit || "km" };
    const referencePatch: { mainWorkout?: string; accessory?: string | null } = {};
    const parseTarget: { id: string; mainWorkout?: string | null; accessory?: string | null } = {
      id: planDay.id,
      mainWorkout: planDay.mainWorkout,
      accessory: planDay.accessory,
    };
    if (req.body.mainWorkout !== undefined) {
      referencePatch.mainWorkout = req.body.mainWorkout ?? "";
      parseTarget.mainWorkout = req.body.mainWorkout;
    }
    if (req.body.accessory !== undefined) {
      referencePatch.accessory = req.body.accessory;
      parseTarget.accessory = req.body.accessory;
    }
    void incrementStructuredExerciseCounter("plan_day", "voice", "parse_text_attempted").catch(() => undefined);
    try {
      const result = await reparsePlanDay(parseTarget, unitPreferences);
      if (result && Object.keys(referencePatch).length > 0) {
        await storage.plans.updatePlanDay(planDay.id, referencePatch, userId);
      }
      return sendParseWriteThroughResponse(res, "plan_day", "voice", result);
    } catch (error: unknown) {
      return sendPlanDayReparseError(req, res, error, userId, "text");
    }
  },
);

// Photo sibling of /reparse for plan days. Same replace semantics, same
// rate bucket — only the input modality differs. Body size enforced by
// the route-scoped 10MB express.json() in server/index.ts.
protectedPost(
  router,
  "/api/v1/plans/days/:dayId/reparse-from-image",
  { limiter: rateLimiter("planDayReparse", 5), aiConsent: true, aiBudget: true, validation: [validateBody(parseExercisesFromImageRequestSchema)] },
  async (req: ExpressRequest<{ dayId: string }, unknown, z.infer<typeof parseExercisesFromImageRequestSchema>>, res: Response) => {
    const userId = getUserId(req);
    const [planDay, user, customExercises] = await Promise.all([
      storage.plans.getPlanDay(req.params.dayId, userId),
      storage.users.getUser(userId),
      storage.users.getCustomExercises(userId),
    ]);
    if (!planDay) {
      return sendNotFound(res, PLAN_DAY_NOT_FOUND);
    }
    const unitPreferences = { weightUnit: user?.weightUnit || "kg", distanceUnit: user?.distanceUnit || "km" };
    const customNames = customExercises.map((e) => e.name);
    void incrementStructuredExerciseCounter("plan_day", "photo", "parse_photo_attempted").catch(() => undefined);
    try {
      const result = await reparsePlanDayFromImage(planDay, req.body, unitPreferences, userId, customNames);
      return sendParseWriteThroughResponse(res, "plan_day", "photo", result);
    } catch (error: unknown) {
      return sendPlanDayReparseError(req, res, error, userId, "photo");
    }
  },
);

// Manual coach-note refresh for a planned day. Triggered from the workout
// detail dialog after an athlete edits the prescribed exercises so the
// static `ai_rationale` doesn't go stale. Guarded by AI consent and budget checks because
// it burns an AI provider call per invocation; the service itself enforces a
// 30-second cooldown to prevent Refresh-mashing. Low per-IP/user rate
// limit stacks on top of that.
protectedPost(
  router,
  "/api/v1/plans/days/:dayId/coach-note/regenerate",
  { limiter: rateLimiter("coachNoteRegenerate", 10), aiConsent: true, aiBudget: true },
  async (req: ExpressRequest<{ dayId: string }>, res: Response) => {
    const userId = getUserId(req);
    const result = await regenerateCoachNoteForPlanDay(req.params.dayId, userId);
    if ("retryAfterMs" in result) {
      const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        error: "Coach note was just refreshed — try again in a moment.",
        code: "COOLDOWN",
        retryAfterMs: result.retryAfterMs,
      });
    }
    res.json(result);
  },
);

export default router;

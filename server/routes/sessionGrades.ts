import type { SessionGradesResponse, WorkoutSessionGradeResponse } from "@shared/schema";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

import { isAuthenticated } from "../clerkAuth";
import { asyncHandler, rateLimiter, sendNotFound, validateQuery } from "../routeUtils";
import { buildPlanSessionGrades, gradeWorkoutLogs } from "../services/sessionGrades/sessionGradeService";
import { requestSessionStreamForLog } from "../services/sessionStreamHooks";
import { storage } from "../storage";
import { getUserId } from "../types";

const router = Router();

const sessionGradesQuerySchema = z.object({ planId: z.string().min(1).max(255).optional() }).strict();
type SessionGradesQuery = z.infer<typeof sessionGradesQuerySchema>;

/**
 * "Did the session do its job?" for one plan: every graded run with its
 * verdict, rolled up by plan week and training block. Defaults to the active
 * plan; no plan at all is an empty payload, not an error. Grades are computed
 * on read (sessionGradeService.ts), so nothing here is cached or persisted.
 */
router.get(
  "/api/v1/session-grades",
  isAuthenticated,
  rateLimiter("analytics", 20),
  validateQuery(sessionGradesQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { planId } = req.query as unknown as SessionGradesQuery;
    const response: SessionGradesResponse = await buildPlanSessionGrades(storage, getUserId(req), planId);
    res.json(response);
  }),
);

/**
 * One workout's grade, for its detail view. A separate read rather than a
 * field on GET /workouts/:id: the detail cache is replaced by every PATCH
 * response, and a grade whose stream is still on its way refetches on its own
 * cadence. `grade` is null for anything we do not grade (not plan-linked, not
 * a run, a session kind with no grader yet).
 */
router.get(
  "/api/v1/workouts/:id/session-grade",
  isAuthenticated,
  rateLimiter("sessionGrade", 60),
  asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
    const userId = getUserId(req);
    const log = await storage.workouts.getWorkoutLog(req.params.id, userId);
    if (!log) return sendNotFound(res, "Workout not found");
    const grade = (await gradeWorkoutLogs(storage, userId, [log])).get(log.id) ?? null;
    // Opening a run whose stream has not arrived is the moment it matters:
    // nudge the fetcher rather than waiting for the backfill scan.
    if (grade?.streamStatus === "pending") {
      await requestSessionStreamForLog(storage, userId, log, "read");
    }
    const response: WorkoutSessionGradeResponse = { grade };
    res.json(response);
  }),
);

export default router;

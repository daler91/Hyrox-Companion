import type { DistanceUnit } from "@shared/unitConversion";
import type { Request, Response, Router } from "express";
import { z } from "zod";

import { rateLimiter, validateBody } from "../../routeUtils";
import {
  dismissDeviceLinkSuggestion,
  linkStandaloneDeviceLog,
  unlinkDeviceActivity,
} from "../../services/deviceActivityLink";
import { storage } from "../../storage";
import { getUserId } from "../../types";
import { protectedDelete, protectedPost } from "../_helpers/protectedRouteBuilder";

/**
 * Exactly one target. The timeline sends whichever the suggestion named, or
 * whatever the athlete picked from the day's rows.
 */
export const linkDeviceActivitySchema = z
  .object({
    planDayId: z.string().min(1).optional(),
    workoutLogId: z.string().min(1).optional(),
  })
  .strict()
  .refine((body) => (body.planDayId ? 1 : 0) + (body.workoutLogId ? 1 : 0) === 1, {
    message: "Provide exactly one of planDayId or workoutLogId",
  });

/**
 * Device activity links are the one place the athlete's judgement must beat
 * the matcher, so both directions get a route:
 *
 *  POST   /api/v1/workouts/:id/device-link   merge standalone Strava log :id
 *                                            into a plan day or a manual log
 *  DELETE /api/v1/workouts/:id/device-link   take the Strava activity off log
 *                                            :id and give it its own row again
 *  DELETE /api/v1/workouts/:id/device-link/suggestion
 *                                            "not this one": drop the match the
 *                                            sync suggested for standalone import :id
 *
 * Both return the row the athlete will look at next: the merged log, or the
 * activity's new standalone row (plus what remains of the unlinked log).
 */
export function registerWorkoutDeviceLinkRoutes(router: Router): void {
  protectedPost(
    router,
    "/api/v1/workouts/:id/device-link",
    { limiter: rateLimiter("workout", 40), middleware: [validateBody(linkDeviceActivitySchema)] },
    async (req: Request<{ id: string }>, res: Response) => {
      const body = req.body as z.infer<typeof linkDeviceActivitySchema>;
      const target = body.planDayId
        ? { planDayId: body.planDayId }
        : { workoutLogId: body.workoutLogId as string };
      const log = await linkStandaloneDeviceLog({
        userId: getUserId(req),
        deviceLogId: req.params.id,
        target,
      });
      res.json(log);
    },
  );

  protectedDelete(
    router,
    "/api/v1/workouts/:id/device-link",
    { limiter: rateLimiter("workout", 40) },
    async (req: Request<{ id: string }>, res: Response) => {
      const userId = getUserId(req);
      const user = await storage.users.getUser(userId);
      const result = await unlinkDeviceActivity({
        userId,
        logId: req.params.id,
        distanceUnit: (user?.distanceUnit || "km") as DistanceUnit,
      });
      res.json(result);
    },
  );

  protectedDelete(
    router,
    "/api/v1/workouts/:id/device-link/suggestion",
    { limiter: rateLimiter("workout", 40) },
    async (req: Request<{ id: string }>, res: Response) => {
      const log = await dismissDeviceLinkSuggestion({
        userId: getUserId(req),
        logId: req.params.id,
      });
      res.json(log);
    },
  );
}

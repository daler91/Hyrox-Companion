import {
  type BatchLogResponse,
  type CreateFoodLogBatchInput,
  createFoodLogBatchSchema,
  type CreateFoodLogInput,
  createFoodLogSchema,
  type MealType,
  type RepeatDayInput,
  repeatDaySchema,
  type UpdateFoodLogInput,
  updateFoodLogSchema,
} from "@shared/schema";
import { type Request, type Response, Router } from "express";

import { rateLimiter, sendNotFound, validateBody } from "../../routeUtils";
import { storage } from "../../storage";
import { getLocalDateStr } from "../../timezone";
import { getUserId } from "../../types";
import { protectedDelete, protectedPatch, protectedPost } from "../_helpers/protectedRouteBuilder";
import { FOOD_NOT_FOUND, getUserTimezone, LOG_ENTRY_NOT_FOUND } from "./shared";

// Food log entries (FR-1.2, FR-1.5, FR-1.6, FR-4.1 confirm): create, edit,
// delete, repeat a day, and the reviewed-items batch write. Every write
// derives logDate server-side from the user's timezone.
export function registerNutritionLogRoutes(router: Router): void {
  // ---- logging (FR-1.2 / FR-1.3 / FR-1.6) ----------------------------------
  // FR-1.2 — log a food. The server derives `logDate` from `loggedAt` + the
  // user's timezone; never trust a client-sent date (cross-midnight bug class).
  protectedPost(
    router,
    "/api/v1/nutrition/logs",
    { limiter: rateLimiter("nutritionLog", 60), middleware: [validateBody(createFoodLogSchema)] },
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const body = req.body as CreateFoodLogInput;
      const food = await storage.nutrition.getVisibleFoodById(userId, body.foodId);
      if (!food) {
        sendNotFound(res, FOOD_NOT_FOUND);
        return;
      }

      const loggedAt = new Date(body.loggedAt);
      const logDate = getLocalDateStr(loggedAt, await getUserTimezone(userId));
      const entry = await storage.nutrition.createLogEntry(userId, {
        foodId: body.foodId,
        quantityG: body.quantityG,
        mealType: body.mealType,
        loggedAt,
        logDate,
        entryMethod: body.entryMethod,
      });
      res.status(201).json(entry);
    },
  );

  // FR-1.6 — edit a log entry. Recompute logDate if the instant moved.
  protectedPatch(
    router,
    "/api/v1/nutrition/logs/:id",
    { limiter: rateLimiter("nutritionLog", 60), middleware: [validateBody(updateFoodLogSchema)] },
    async (req: Request<{ id: string }>, res: Response) => {
      const userId = getUserId(req);
      const body = req.body as UpdateFoodLogInput;
      const patch: { quantityG?: number; mealType?: MealType; loggedAt?: Date; logDate?: string } = {};
      if (body.quantityG !== undefined) patch.quantityG = body.quantityG;
      if (body.mealType !== undefined) patch.mealType = body.mealType;
      if (body.loggedAt !== undefined) {
        const loggedAt = new Date(body.loggedAt);
        patch.loggedAt = loggedAt;
        patch.logDate = getLocalDateStr(loggedAt, await getUserTimezone(userId));
      }
      const updated = await storage.nutrition.updateLogEntry(userId, req.params.id, patch);
      if (!updated) {
        sendNotFound(res, LOG_ENTRY_NOT_FOUND);
        return;
      }
      res.json(updated);
    },
  );

  // FR-1.6 — delete a log entry.
  protectedDelete(
    router,
    "/api/v1/nutrition/logs/:id",
    { limiter: rateLimiter("nutritionLog", 60) },
    async (req: Request<{ id: string }>, res: Response) => {
      const deleted = await storage.nutrition.deleteLogEntry(getUserId(req), req.params.id);
      if (!deleted) {
        sendNotFound(res, LOG_ENTRY_NOT_FOUND);
        return;
      }
      res.json({ success: true });
    },
  );

  // FR-1.5 — repeat a previous day (or one of its meals) onto a target day.
  protectedPost(
    router,
    "/api/v1/nutrition/logs/repeat",
    { limiter: rateLimiter("nutritionLog", 20), middleware: [validateBody(repeatDaySchema)] },
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const body = req.body as RepeatDayInput;
      const tz = await getUserTimezone(userId);
      const now = new Date();
      const todayStr = getLocalDateStr(now, tz);
      const targetDate = body.targetDate ?? todayStr;
      // Repeating onto today stamps "now"; onto another date, local noon of that
      // date so the entry's instant falls within its logDate for most zones.
      const loggedAt = targetDate === todayStr ? now : new Date(`${targetDate}T12:00:00Z`);
      const created = await storage.nutrition.repeatDay(userId, {
        sourceDate: body.sourceDate,
        mealType: body.mealType,
        targetDate,
        loggedAt,
      });
      if (created === 0) {
        sendNotFound(res, "No entries found to repeat for that day");
        return;
      }
      res.status(201).json({ created, logDate: targetDate });
    },
  );

  // FR-4.1 — confirm reviewed items: persist them in one batch. Pure DB write
  // (no AI gate). logDate is derived server-side from the user's timezone.
  protectedPost(
    router,
    "/api/v1/nutrition/logs/batch",
    { limiter: rateLimiter("nutritionLog", 60), validation: [validateBody(createFoodLogBatchSchema)] },
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const body = req.body as CreateFoodLogBatchInput;
      // Every food must be visible to the user (no cross-user / unknown foods).
      const ids = body.items.map((i) => i.foodId);
      const visible = await storage.nutrition.getVisibleFoodsByIds(userId, ids);
      if (ids.some((id) => !visible.has(id))) {
        sendNotFound(res, FOOD_NOT_FOUND);
        return;
      }

      const loggedAt = new Date(body.loggedAt);
      const logDate = getLocalDateStr(loggedAt, await getUserTimezone(userId));
      const created = await storage.nutrition.createLogEntriesBatch(userId, {
        entryMethod: body.entryMethod,
        rawInput: body.rawInput ?? null,
        loggedAt,
        logDate,
        items: body.items.map((i) => ({
          foodId: i.foodId,
          quantityG: i.quantityG,
          mealType: i.mealType,
          parseConfidence: i.parseConfidence ?? null,
        })),
      });
      const response: BatchLogResponse = { created: created.length, logDate };
      res.status(201).json(response);
    },
  );
}

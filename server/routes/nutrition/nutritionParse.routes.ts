import {
  type ParseExercisesFromImageRequest,
  parseExercisesFromImageRequestSchema,
  type ParseMealResponse,
  type ParseMealTextInput,
  parseMealTextSchema,
} from "@shared/schema";
import { type Request, type Response, Router } from "express";

import { rateLimiter, validateBody } from "../../routeUtils";
import { parseNutritionLabel } from "../../services/nutrition/labelParser";
import { parseMealFromPhoto, parseMealFromText, resolveAndPreview } from "../../services/nutrition/mealParser";
import { getUserId } from "../../types";
import { protectedPost } from "../_helpers/protectedRouteBuilder";

// Natural-language and image parsing (FR-4.1, label scan). Suggestions only;
// the client confirms through POST /logs/batch (nutritionLogs.routes.ts).
// The /parse/photo and /parse/label paths are pinned by server/imageParsePaths.ts.
export function registerNutritionParseRoutes(router: Router): void {
  // ---- Phase 4 (Natural-language logging) ----------------------------------
  // FR-4.1 — parse a free-text meal description into suggested food items.
  // AI-gated (consent + daily budget) and on the shared "parse" rate bucket.
  // Returns suggestions only; nothing is logged until the client confirms via
  // /logs/batch (never auto-log an AI guess).
  protectedPost(
    router,
    "/api/v1/nutrition/parse/text",
    {
      limiter: rateLimiter("parse", 5),
      aiConsent: true,
      aiBudget: true,
      validation: [validateBody(parseMealTextSchema)],
    },
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const { text } = req.body as ParseMealTextInput;
      const raw = await parseMealFromText(text, userId);
      const { items, warnings } = await resolveAndPreview(raw, userId);
      const response: ParseMealResponse = { items, warnings, rawInput: text };
      res.json(response);
    },
  );

  // FR-4.1 (photo) — parse a meal *photo* into suggested food items. Same
  // contract + review flow as /parse/text, but the image goes to Gemini Vision
  // (direct — the provider abstraction has no vision method). The 10MB body
  // parser is mounted for this exact path via server/imageParsePaths.ts.
  protectedPost(
    router,
    "/api/v1/nutrition/parse/photo",
    {
      limiter: rateLimiter("parse", 5),
      aiConsent: true,
      aiBudget: true,
      validation: [validateBody(parseExercisesFromImageRequestSchema)],
    },
    async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const { imageBase64, mimeType } = req.body as ParseExercisesFromImageRequest;
      const raw = await parseMealFromPhoto(imageBase64, mimeType, userId);
      const { items, warnings } = await resolveAndPreview(raw, userId);
      const response: ParseMealResponse = { items, warnings, rawInput: "[photo]" };
      res.json(response);
    },
  );

  // Label scan — transcribe a nutrition-label *photo* into exact per-100g
  // macros to prefill the custom-food form. Same gating and 10MB body-parser
  // mounting (server/imageParsePaths.ts) as /parse/photo, but the model
  // transcribes the printed panel instead of estimating a meal. Returns 200
  // with `label: null` when the image holds no readable label; nothing is
  // persisted until the user saves the reviewed food.
  protectedPost(
    router,
    "/api/v1/nutrition/parse/label",
    {
      limiter: rateLimiter("parse", 5),
      aiConsent: true,
      aiBudget: true,
      validation: [validateBody(parseExercisesFromImageRequestSchema)],
    },
    async (req: Request, res: Response) => {
      const { imageBase64, mimeType } = req.body as ParseExercisesFromImageRequest;
      const response = await parseNutritionLabel(imageBase64, mimeType, getUserId(req));
      res.json(response);
    },
  );
}

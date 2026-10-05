import express, { type RequestHandler } from "express";

import { isChatSendPath, isImageParsePath } from "./imageParsePaths";

/**
 * JSON body parsers for the few routes that take more than the app-wide 100kb.
 *
 * They used to run at app level, ahead of Clerk auth and every rate limiter,
 * so an anonymous client could make the instance buffer and parse multi-MB
 * bodies at will. Now the app-level parser leaves these paths alone
 * (skipLargeJsonBodyPaths) and the protected route stack parses them after the
 * auth guard and the route's rate limiter (largeJsonBodyParser). Oversized
 * bodies still fail with body-parser's 413, which globalErrorHandler shapes
 * the same way as before. D35 (CODEBASE_ANALYSIS_2026-10-03)
 */

// Image-parse routes ship the image as a base64 string in the JSON body; the
// schema caps base64 length at 10MB, so this parser matches it. Covers the
// stateless image parsers and the stateful reparse siblings on workouts and
// plan days (`.../:id/reparse-from-image`).
const imageParseJsonParser = express.json({ limit: "10mb" });
// A coach chat message can carry one photo (CHAT_PHOTO_MAX_BASE64_CHARS,
// capped again by the request schema), so the two send routes get room for it.
const chatSendJsonParser = express.json({ limit: "5mb" });
// Coaching material routes accept large document content (up to 1.5M chars).
const coachingMaterialsJsonParser = express.json({ limit: "2mb" });

const COACHING_MATERIALS_PATH_RE = /^\/api\/v1\/coaching-materials(?:\/|$)/u;

function largeJsonParserFor(path: string): RequestHandler | null {
  if (isImageParsePath(path)) return imageParseJsonParser;
  if (isChatSendPath(path)) return chatSendJsonParser;
  if (COACHING_MATERIALS_PATH_RE.test(path)) return coachingMaterialsJsonParser;
  return null;
}

/** Whether a request path takes a JSON body larger than the app-wide limit. */
export function needsLargeJsonBody(path: string): boolean {
  return largeJsonParserFor(path) !== null;
}

/**
 * Wrap the app-level JSON parser so it skips the large-body paths, leaving
 * their bodies unread until the route stack has authenticated and
 * rate-limited the caller.
 */
export function skipLargeJsonBodyPaths(parser: RequestHandler): RequestHandler {
  return (req, res, next) => {
    if (needsLargeJsonBody(req.path)) {
      next();
      return;
    }
    parser(req, res, next);
  };
}

/**
 * Parse a large-body route's JSON with its own limit. Mounted in every
 * protected route stack right after the rate limiter; a no-op for any other
 * path, and for a body something upstream already read.
 */
export const largeJsonBodyParser: RequestHandler = (req, res, next) => {
  const parser = largeJsonParserFor(`${req.baseUrl}${req.path}`);
  if (!parser) {
    next();
    return;
  }
  parser(req, res, next);
};

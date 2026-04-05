import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { getUserId } from "../types";
import { logger } from "../logger";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const MAX_KEY_LENGTH = 255;

/**
 * Server-side enforcement for the `X-Idempotency-Key` header that
 * `client/src/lib/offlineQueue.ts` sends on replay (CODEBASE_AUDIT.md §2).
 *
 * On a repeat request with the same (userId, key), returns the cached
 * response without re-executing the downstream handler. Non-mutating methods
 * and requests without a key fall through untouched. Must be mounted AFTER
 * `isAuthenticated` so `getUserId` can resolve the caller.
 */
export async function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!MUTATING_METHODS.has(req.method)) return next();

  const rawKey = req.header("x-idempotency-key");
  if (!rawKey) return next();
  if (rawKey.length > MAX_KEY_LENGTH) {
    res.status(400).json({ error: "X-Idempotency-Key too long", code: "BAD_REQUEST" });
    return;
  }
  const key = rawKey;

  let userId: string;
  try {
    userId = getUserId(req);
  } catch {
    // Middleware mounted after isAuthenticated, so this shouldn't happen —
    // skip rather than 500 to avoid masking the real auth error.
    return next();
  }

  try {
    const prior = await storage.idempotency.get(userId, key);
    if (prior) {
      res.status(prior.statusCode).json(prior.responseBody);
      return;
    }
  } catch (err) {
    // Storage failure should not block writes; log and continue without
    // idempotency guarantees for this request.
    (req.log || logger).error({ err }, "idempotency lookup failed, continuing without cache");
    return next();
  }

  // Intercept res.json so we can persist the successful response payload.
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    const statusCode = res.statusCode || 200;
    // Only cache 2xx responses — replaying a cached 4xx/5xx would mask a
    // transient error once the underlying issue is fixed.
    if (statusCode >= 200 && statusCode < 300) {
      void storage.idempotency
        .set(userId, key, {
          method: req.method,
          path: req.path,
          statusCode,
          responseBody: body,
        }, IDEMPOTENCY_TTL_SECONDS)
        .catch((err) => {
          (req.log || logger).error({ err }, "Failed to persist idempotency record");
        });
    }
    return originalJson(body);
  }) as typeof res.json;

  next();
}

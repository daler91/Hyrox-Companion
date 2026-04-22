import type { NextFunction,Request, Response } from "express";

import { logger } from "../logger";
import { storage } from "../storage";
import { getUserId } from "../types";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// 1h window is plenty for offlineQueue replay (normal retry is seconds to
// minutes after reconnect) and dramatically shrinks the stale-payload
// exposure if a user mutates or deletes the underlying resource between the
// original write and the replay (CODEBASE_AUDIT.md §2, Warning-1).
const IDEMPOTENCY_TTL_SECONDS = 60 * 60;
const MAX_KEY_LENGTH = 255;
// Cap the cached response size. Above this we still de-dupe (we record the
// status code) but skip persisting the body so we don't duplicate large
// payloads — stops a rogue handler from turning the idempotency table into
// a secondary data store.
const MAX_CACHED_PAYLOAD_BYTES = 64 * 1024;

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
      // Skip caching oversized bodies. A retry will re-execute the handler,
      // which is safe because the idempotency invariant for these routes is
      // enforced by downstream uniqueness constraints (e.g. unique
      // strava_activity_id), not by this cache.
      const serialized = JSON.stringify(body);
      const byteLength = Buffer.byteLength(serialized, "utf8");
      if (byteLength > MAX_CACHED_PAYLOAD_BYTES) {
        (req.log || logger).warn(
          { byteLength, limit: MAX_CACHED_PAYLOAD_BYTES, path: req.path },
          "Idempotency response exceeded cache size cap; skipping persistence",
        );
      } else {
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
    }
    return originalJson(body);
  }) as typeof res.json;

  next();
}

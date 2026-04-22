import type { NextFunction,Request, Response } from "express";

import { logger } from "../logger";
import { storage } from "../storage";
import { getUserId } from "../types";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Must be ≥ client offlineQueue's MAX_AGE_MS (7d) so a write can't escape
// the de-dupe window: a queued mutation the client replays after 2–6d
// offline must still hit the cached outcome instead of double-executing
// against endpoints that have no natural dedup key (e.g.
// coaching-materials, which does an unconditional insert).
const IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_KEY_LENGTH = 255;
// Cap the stored response body to keep the idempotency table from becoming
// a secondary data store. Above the cap we still persist the key with a
// sentinel body so replays short-circuit the handler (Codex P1 on #877);
// only the full payload is discarded.
const MAX_CACHED_PAYLOAD_BYTES = 64 * 1024;
const OVERSIZED_SENTINEL_BODY = { idempotencyReplayed: true as const };

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
      // Always persist the key on success — otherwise a retry with the
      // same X-Idempotency-Key re-executes the mutation (Codex P1 on
      // #877). For oversized responses we persist a sentinel body
      // instead of the full payload; the offlineQueue caller that sets
      // the header (client/src/lib/offlineQueue.ts) ignores the response
      // body, so the stub is only a signal that the write was already
      // applied.
      // JSON.stringify returns undefined for bare `undefined`, functions,
      // and top-level Symbols; Buffer.byteLength would throw on those. A
      // non-stringifiable body serialises to zero bytes from the
      // idempotency cache's perspective, so treat it as empty rather than
      // letting the error tank the response (Codex review of #877).
      const serialized = JSON.stringify(body);
      const byteLength = typeof serialized === "string" ? Buffer.byteLength(serialized, "utf8") : 0;
      const oversized = byteLength > MAX_CACHED_PAYLOAD_BYTES;
      if (oversized) {
        (req.log || logger).warn(
          { byteLength, limit: MAX_CACHED_PAYLOAD_BYTES, path: req.path },
          "Idempotency response exceeded cache size cap; storing sentinel body",
        );
      }
      const storedBody: unknown = oversized ? OVERSIZED_SENTINEL_BODY : body;
      void storage.idempotency
        .set(userId, key, {
          method: req.method,
          path: req.path,
          statusCode,
          responseBody: storedBody,
        }, IDEMPOTENCY_TTL_SECONDS)
        .catch((err) => {
          (req.log || logger).error({ err }, "Failed to persist idempotency record");
        });
    }
    return originalJson(body);
  }) as typeof res.json;

  next();
}

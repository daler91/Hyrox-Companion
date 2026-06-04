import type { NextFunction,Request, Response } from "express";

import { reqLogger } from "../logger";
import { storage } from "../storage";
import type { IdempotencyClaim } from "../storage/idempotency";
import { getUserId } from "../types";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Must be ≥ client offlineQueue's MAX_AGE_MS (7d) so a write can't escape
// the de-dupe window: a queued mutation the client replays after 2–6d
// offline must still hit the cached outcome instead of double-executing
// against endpoints that have no natural dedup key (e.g.
// coaching-materials, which does an unconditional insert).
const IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;
// An in-progress claim expires quickly so a crashed/aborted request frees the
// key for retry within roughly a request timeout, not the full 7-day window.
// `claim()` treats an expired row as takeable.
const CLAIM_TTL_SECONDS = 60;
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

  // Atomically claim the key BEFORE the handler runs (W11). This closes the
  // check-then-act race where two concurrent requests both miss a prior lookup
  // and both execute. A storage failure here must not block writes — fall
  // through without idempotency, as the old lookup did.
  let outcome: IdempotencyClaim;
  try {
    outcome = await storage.idempotency.claim(
      userId,
      key,
      { method: req.method, path: req.path },
      CLAIM_TTL_SECONDS,
    );
  } catch (err) {
    reqLogger(req).error({ err }, "idempotency claim failed, continuing without cache");
    return next();
  }

  if (outcome.outcome === "completed") {
    // A prior request with this key already finished — replay its response
    // without re-executing the handler.
    res.status(outcome.statusCode).json(outcome.responseBody);
    return;
  }
  if (outcome.outcome === "in_progress") {
    // A concurrent request owns the key and hasn't finished. Reject the
    // duplicate so the handler can't run twice; the client retries and gets the
    // cached result once the first request completes.
    res.status(409).json({
      error: "A request with this idempotency key is already being processed. Please retry shortly.",
      code: "IDEMPOTENT_REQUEST_IN_PROGRESS",
    });
    return;
  }

  // outcome.outcome === "claimed": we own the key. Persist the real response on
  // a 2xx result; otherwise release the claim so the same key can be retried.
  // `settle` runs the terminal action exactly once.
  let settled = false;
  const settle = (work: () => Promise<void>): void => {
    if (settled) return;
    settled = true;
    void work().catch((err) => {
      reqLogger(req).error({ err }, "Failed to finalize idempotency record");
    });
  };

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    const statusCode = res.statusCode || 200;
    // Idempotency semantics (S10): only 2xx responses are cached. A retry that
    // carries the same X-Idempotency-Key after a non-2xx result intentionally
    // re-executes the handler (releasing the claim below), so a transient
    // failure (a 5xx, or a 404 from read-after-write lag) is retried rather
    // than being pinned by a cached error.
    if (statusCode >= 200 && statusCode < 300) {
      // For oversized responses we persist a sentinel body instead of the full
      // payload; the offlineQueue caller that sets the header ignores the
      // response body, so the stub is only a signal that the write was applied.
      // JSON.stringify returns undefined for bare `undefined`, functions, and
      // top-level Symbols; Buffer.byteLength would throw on those, so treat a
      // non-stringifiable body as zero bytes (Codex review of #877).
      const serialized = JSON.stringify(body);
      const byteLength = typeof serialized === "string" ? Buffer.byteLength(serialized, "utf8") : 0;
      const oversized = byteLength > MAX_CACHED_PAYLOAD_BYTES;
      if (oversized) {
        reqLogger(req).warn(
          { byteLength, limit: MAX_CACHED_PAYLOAD_BYTES, path: req.path },
          "Idempotency response exceeded cache size cap; storing sentinel body",
        );
      }
      const storedBody: unknown = oversized ? OVERSIZED_SENTINEL_BODY : body;
      settle(() =>
        storage.idempotency.complete(userId, key, { statusCode, responseBody: storedBody }, IDEMPOTENCY_TTL_SECONDS),
      );
    } else {
      settle(() => storage.idempotency.release(userId, key));
    }
    return originalJson(body);
  }) as typeof res.json;

  // Backstop: if the response finishes or the connection closes without going
  // through res.json (an error sent via res.end, a streamed/redirect response,
  // or a client abort), release the claim so it doesn't pin retries until the
  // short claim TTL lapses. The `settled` guard keeps this idempotent.
  const releaseIfUnsettled = (): void => settle(() => storage.idempotency.release(userId, key));
  res.on("finish", releaseIfUnsettled);
  res.on("close", releaseIfUnsettled);

  next();
}

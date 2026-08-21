import type { Express } from "express";
import type { Pool, PoolClient } from "pg";

import { logger } from "../logger";

export interface StartupHealthState {
  isReady: boolean;
  startupError: string | null;
  startupPhase: string;
  startupBeganAt: number;
}

const HEALTH_PROBE_TIMEOUT_MS = 3000;

export async function probePool(pool: Pool): Promise<boolean> {
  const clientRef: { current: PoolClient | undefined } = { current: undefined };
  let timedOut = false;
  const connectAndQuery = (async () => {
    const c = await pool.connect();
    clientRef.current = c;
    if (timedOut) {
      c.release(new Error("health check timeout"));
      clientRef.current = undefined;
      throw new Error("timeout");
    }
    await c.query("SELECT 1");
  })();

  try {
    await Promise.race([
      connectAndQuery,
      new Promise((_, reject) => setTimeout(() => {
        timedOut = true;
        reject(new Error("timeout"));
      }, HEALTH_PROBE_TIMEOUT_MS)),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clientRef.current?.release(timedOut ? new Error("health check timeout") : undefined);
  }
}

// W21 — cache the two DB probes for a few seconds so high-frequency liveness
// checks don't open a fresh DB connection on every call. In-process (not the
// DB-backed shared cache, which would defeat the purpose) and per-instance,
// which is correct: each replica reports its own health. Concurrent misses
// share a single in-flight probe round.
const HEALTH_CACHE_TTL_MS = 5000;

interface ProbeResult {
  dbOk: boolean;
  vectorDbOk: boolean;
}

interface HealthProbeDeps {
  probeDatabase: () => Promise<boolean>;
  probeVectorDatabase: () => Promise<boolean>;
}

let cachedProbe: { at: number; result: ProbeResult } | null = null;
let inFlightProbe: Promise<ProbeResult> | null = null;

function getCachedProbeResult(deps: HealthProbeDeps): Promise<ProbeResult> {
  if (cachedProbe && Date.now() - cachedProbe.at < HEALTH_CACHE_TTL_MS) {
    return Promise.resolve(cachedProbe.result);
  }
  if (inFlightProbe) return inFlightProbe;
  inFlightProbe = Promise.all([deps.probeDatabase(), deps.probeVectorDatabase()])
    .then(([dbOk, vectorDbOk]) => {
      const result: ProbeResult = { dbOk, vectorDbOk };
      cachedProbe = { at: Date.now(), result };
      return result;
    })
    .finally(() => {
      inFlightProbe = null;
    });
  return inFlightProbe;
}

// Exposed for tests to clear the per-process cache between cases.
export function __resetHealthCacheForTests(): void {
  cachedProbe = null;
  inFlightProbe = null;
}

export function registerHealthEndpoint(app: Express, deps: {
  state: StartupHealthState;
  probeDatabase: () => Promise<boolean>;
  probeVectorDatabase: () => Promise<boolean>;
  /**
   * Outcome of boot-time vector-schema setup (`getVectorSchemaStatus` in
   * `server/maintenance.ts`). Reported but NOT gated on: the vector DB holds
   * derived data, so a restore that lost it should still serve traffic while
   * an operator re-embeds. The point is that the restore drill can see it —
   * `probeVectorDatabase` only proves the pool answers `SELECT 1`, which it
   * does happily when the tables were never created.
   */
  vectorSchemaStatus?: () => string;
}): void {
  // Liveness probe (W7): dependency-free. Returns 200 whenever the process is up
  // and the event loop can serve HTTP — it deliberately does NOT probe the DB,
  // so a transient runtime DB blip cannot make a healthy instance look dead and
  // trigger a restart loop. The one exception is a definitive startup failure,
  // where a restart can legitimately retry boot (e.g. DB unreachable at boot).
  // Point the platform's restart healthcheck at THIS, and use /api/v1/health
  // (readiness, below) only for load-balancer traffic gating.
  // Both /health and /health/live are mounted before auth (platform probes
  // hit them with no credentials — see the module-level comment in
  // index.ts), so their responses are readable by anyone on the internet.
  // `startupState.startupError` is a raw `Error.message` from wherever boot
  // failed (e.g. a Postgres driver error), which can contain internal
  // hostnames/ports or DB usernames — the full text is already captured
  // server-side via `logger.fatal({ err, phase })` in index.ts, so the
  // public response only needs the (fixed, non-sensitive) failed phase, not
  // the raw message.
  app.get("/api/v1/health/live", (_req, res) => {
    if (deps.state.startupError) {
      res.status(503).json({ status: "startup_failed", phase: deps.state.startupPhase, timestamp: Date.now() });
      return;
    }
    res.json({ status: "alive", uptimeMs: Date.now() - deps.state.startupBeganAt, timestamp: Date.now() });
  });

  // Readiness probe: gates on startup state + DB/vector-DB health. A 503 here
  // means "don't route traffic to me right now" — it should NOT be wired to a
  // restart policy (see the liveness probe above).
  app.get("/api/v1/health", (_req, res) => {
    const uptimeMs = Date.now() - deps.state.startupBeganAt;
    if (deps.state.startupError) {
      res.status(503).json({ status: "error", error: "startup_error", phase: deps.state.startupPhase, uptimeMs, timestamp: Date.now() });
      return;
    }
    if (!deps.state.isReady) {
      res.status(503).json({ status: "starting", phase: deps.state.startupPhase, uptimeMs, timestamp: Date.now() });
      return;
    }
    const vectorSchema = deps.vectorSchemaStatus?.() ?? "unknown";
    getCachedProbeResult(deps).then(({ dbOk, vectorDbOk }) => {
      if (!dbOk || !vectorDbOk) {
        res.status(503).json({ status: "degraded", db: dbOk, vectorDb: vectorDbOk, vectorSchema, uptimeMs, timestamp: Date.now() });
        return;
      }
      res.json({ status: "ok", vectorSchema, uptimeMs, timestamp: Date.now() });
    }).catch((err) => {
      logger.error({ err }, "Health check probe failed unexpectedly");
      res.status(503).json({ status: "error", uptimeMs, timestamp: Date.now() });
    });
  });
}

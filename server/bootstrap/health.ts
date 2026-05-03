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

export function registerHealthEndpoint(app: Express, deps: { state: StartupHealthState; probeDatabase: () => Promise<boolean>; probeVectorDatabase: () => Promise<boolean>; }): void {
  app.get("/api/v1/health", (_req, res) => {
    const uptimeMs = Date.now() - deps.state.startupBeganAt;
    if (deps.state.startupError) return void res.status(503).json({ status: "error", error: "startup_error", phase: deps.state.startupPhase, uptimeMs, message: deps.state.startupError, timestamp: Date.now() });
    if (!deps.state.isReady) return void res.status(503).json({ status: "starting", phase: deps.state.startupPhase, uptimeMs, timestamp: Date.now() });
    Promise.all([deps.probeDatabase(), deps.probeVectorDatabase()]).then(([dbOk, vectorDbOk]) => {
      if (!dbOk || !vectorDbOk) return void res.status(503).json({ status: "degraded", db: dbOk, vectorDb: vectorDbOk, uptimeMs, timestamp: Date.now() });
      res.json({ status: "ok", uptimeMs, timestamp: Date.now() });
    }).catch((err) => {
      logger.error({ err }, "Health check probe failed unexpectedly");
      res.status(503).json({ status: "error", uptimeMs, timestamp: Date.now() });
    });
  });
}

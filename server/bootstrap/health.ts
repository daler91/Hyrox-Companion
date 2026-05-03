import type { Express, Request, Response } from "express";
import type { Pool, PoolClient } from "pg";

export const HEALTH_PROBE_TIMEOUT_MS = 3000;

export interface HealthState {
  isReady: boolean;
  startupError: string | null;
  startupPhase: string;
  startupBeganAt: number;
}

async function probePool(pool: Pool): Promise<boolean> {
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

export function registerHealthEndpoint(params: {
  app: Express;
  getHealthState: () => HealthState;
  probeDatabase: () => Promise<boolean>;
  probeVectorDatabase: () => Promise<boolean>;
  onUnexpectedError: (err: unknown) => void;
}): void {
  const { app, getHealthState, probeDatabase, probeVectorDatabase, onUnexpectedError } = params;

  app.get("/api/v1/health", (_req: Request, res: Response) => {
    const { isReady, startupError, startupPhase, startupBeganAt } = getHealthState();
    const uptimeMs = Date.now() - startupBeganAt;

    if (startupError) {
      res.status(503).json({ status: "error", error: "startup_error", phase: startupPhase, uptimeMs, message: startupError, timestamp: Date.now() });
      return;
    }
    if (!isReady) {
      res.status(503).json({ status: "starting", phase: startupPhase, uptimeMs, timestamp: Date.now() });
      return;
    }
    Promise.all([probeDatabase(), probeVectorDatabase()])
      .then(([dbOk, vectorDbOk]) => {
        if (!dbOk || !vectorDbOk) {
          res.status(503).json({ status: "degraded", db: dbOk, vectorDb: vectorDbOk, uptimeMs, timestamp: Date.now() });
          return;
        }
        res.json({ status: "ok", uptimeMs, timestamp: Date.now() });
      })
      .catch((err) => {
        onUnexpectedError(err);
        res.status(503).json({ status: "error", uptimeMs, timestamp: Date.now() });
      });
  });
}

export const probeDatabasePool = (pool: Pool): Promise<boolean> => probePool(pool);

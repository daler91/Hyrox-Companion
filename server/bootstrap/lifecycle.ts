import type { Server } from "node:http";

import { logger } from "../logger";

export interface ShutdownDeps {
  stopCron: () => void | Promise<void>;
  drainSseStreams: (timeoutMs: number) => Promise<number>;
  stopQueue: () => Promise<void>;
  drainPools: () => Promise<void>;
  flushSentry: (timeoutMs: number) => Promise<void>;
  exit: (code: number) => void;
}

const SHUTDOWN_TIMEOUT_MS = 60_000;

async function runGracefulShutdown(httpServer: Server, deps: ShutdownDeps, forceExit: NodeJS.Timeout): Promise<void> {
  try {
    await deps.stopCron();
    await deps.drainSseStreams(5_000);
    await new Promise<void>((resolve, reject) => httpServer.close((err) => (err ? reject(err) : resolve())));
    await deps.stopQueue();
    await deps.drainPools();
    await deps.flushSentry(10_000);
    clearTimeout(forceExit);
    deps.exit(0);
  } catch (err) {
    logger.error({ err }, "Unexpected error during graceful shutdown. Exiting.");
    clearTimeout(forceExit);
    deps.exit(1);
  }
}

export function registerShutdownHandlers(httpServer: Server, deps: ShutdownDeps): () => void {
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const forceExit = setTimeout(() => {
      logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, "Graceful shutdown timed out. Forcing exit.");
      deps.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();
    void runGracefulShutdown(httpServer, deps, forceExit);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  return shutdown;
}

import type { Server } from "node:http";

import * as Sentry from "@sentry/node";
import type { Pool } from "pg";

import { stopCron } from "../cron";
import { logger } from "../logger";
import { queue } from "../queue";
import { drainSseStreams } from "../sseRegistry";

export const SHUTDOWN_TIMEOUT_MS = 60_000;
export const SSE_DRAIN_TIMEOUT_MS = 5_000;
export const SENTRY_FLUSH_TIMEOUT_MS = 10_000;

export function registerLifecycleHooks(params: {
  server: Server;
  pools: Pool[];
  setStartupError: (message: string) => void;
}): void {
  const { server, pools, setStartupError } = params;
  let shuttingDown = false;

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Received shutdown signal. Starting graceful shutdown...");

    const forceExit = setTimeout(() => {
      logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, "Graceful shutdown timed out. Forcing exit.");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    void (async () => {
      try {
        stopCron();

        const remaining = await drainSseStreams(SSE_DRAIN_TIMEOUT_MS);
        if (remaining > 0) {
          logger.warn({ remaining }, "Some SSE streams did not finish within drain window");
        }

        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
          const closeAll = (server as unknown as { closeAllConnections?: () => void }).closeAllConnections;
          if (typeof closeAll === "function") closeAll.call(server);
        });
        logger.info("HTTP server closed.");

        logger.info("Stopping queue...");
        try {
          await queue.stop();
          logger.info("Queue stopped.");
        } catch (err) {
          logger.error({ err }, "Error stopping queue");
        }

        logger.info("Draining database pools...");
        const drainResults = await Promise.allSettled(pools.map((pool) => pool.end()));
        for (const result of drainResults) {
          if (result.status === "rejected") {
            logger.error({ err: result.reason }, "Error draining a database pool");
          }
        }

        await Sentry.close(SENTRY_FLUSH_TIMEOUT_MS).catch((err) => {
          logger.error({ err }, "Error flushing Sentry");
        });

        clearTimeout(forceExit);
        logger.info("Graceful shutdown complete. Exiting process.");
        process.exit(0);
      } catch (err) {
        logger.error({ err }, "Unexpected error during graceful shutdown. Exiting.");
        clearTimeout(forceExit);
        process.exit(1);
      }
    })();
  };

  server.on("close", () => {
    logger.info({ context: "lifecycle" }, "HTTP server closed");
  });

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception in server process");
    setStartupError(`uncaught_exception: ${err.message}`);
    Sentry.captureException(err);
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "Unhandled rejection in server process");
    setStartupError(`unhandled_rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
    Sentry.captureException(reason);
  });
}

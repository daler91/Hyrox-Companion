import cron from "node-cron";
import { logger } from "./logger";
import { runEmailCronJob } from "./emailScheduler";
import type { IStorage } from "./storage";

let task: ReturnType<typeof cron.schedule> | null = null;
let idempotencyCleanupTask: ReturnType<typeof cron.schedule> | null = null;

/** Start the internal cron scheduler. Runs email checks daily at 09:00 UTC. */
export function startCron(storage: IStorage): void {
  if (task) {
    logger.warn({ context: "cron" }, "Cron already running — skipping duplicate start");
    return;
  }

  // "0 9 * * *" = every day at 09:00 UTC
  task = cron.schedule(
    "0 9 * * *",
    async () => {
      logger.info({ context: "cron" }, "Running scheduled email cron job");
      try {
        const result = await runEmailCronJob(storage);
        logger.info(
          { context: "cron", ...result },
          `Email cron complete: ${result.emailsSent} sent, ${result.usersChecked} checked`,
        );
      } catch (err) {
        logger.error({ context: "cron", err }, "Email cron job failed");
      }
    },
    { timezone: "Etc/UTC" },
  );

  logger.info({ context: "cron" }, "Email cron scheduled: daily at 09:00 UTC");

  // Daily idempotency cache cleanup (CODEBASE_AUDIT.md §2). Rows have a 24h
  // TTL on `expiresAt`; this prunes stale entries so the table does not grow
  // unbounded.
  idempotencyCleanupTask = cron.schedule(
    "30 3 * * *",
    async () => {
      try {
        const deleted = await storage.idempotency.cleanupExpired();
        if (deleted > 0) {
          logger.info({ context: "cron", deleted }, `Idempotency cleanup: removed ${deleted} expired row(s)`);
        }
      } catch (err) {
        logger.error({ context: "cron", err }, "Idempotency cleanup failed");
      }
    },
    { timezone: "Etc/UTC" },
  );
  logger.info({ context: "cron" }, "Idempotency cleanup scheduled: daily at 03:30 UTC");

  // Run a catch-up if the server started after 09:00 UTC (e.g. Railway restart).
  // The idempotency guards in emailScheduler prevent duplicate sends.
  const currentHour = new Date().getUTCHours();
  if (currentHour >= 9) {
    const runCatchUp = async () => {
      logger.info({ context: "cron" }, "Running startup email catch-up (server started after 09:00 UTC)");
      try {
        const result = await runEmailCronJob(storage);
        logger.info(
          { context: "cron", ...result },
          `Startup catch-up complete: ${result.emailsSent} sent, ${result.usersChecked} checked`,
        );
      } catch (err) {
        logger.error({ context: "cron", err }, "Startup email catch-up failed");
      }
    };
    setTimeout(() => void runCatchUp(), 30_000);
  }
}

export function stopCron(): void {
  if (task) {
    const _stop = task.stop(); // result intentionally unused; stop is best-effort during shutdown
    task = null;
    logger.info({ context: "cron" }, "Cron stopped");
  }
  if (idempotencyCleanupTask) {
    const _stop = idempotencyCleanupTask.stop();
    idempotencyCleanupTask = null;
  }
}

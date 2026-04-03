import cron from "node-cron";
import { logger } from "./logger";
import { runEmailCronJob } from "./emailScheduler";
import type { IStorage } from "./storage";

let task: ReturnType<typeof cron.schedule> | null = null;

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
}

export function stopCron(): void {
  if (task) {
    const _stop = task.stop(); // result intentionally unused; stop is best-effort during shutdown
    task = null;
    logger.info({ context: "cron" }, "Cron stopped");
  }
}

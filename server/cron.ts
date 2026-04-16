import cron from "node-cron";

import { runEmailCronJob } from "./emailScheduler";
import { logger } from "./logger";
import type { IStorage } from "./storage";

let task: ReturnType<typeof cron.schedule> | null = null;
let idempotencyCleanupTask: ReturnType<typeof cron.schedule> | null = null;
let aiUsageCleanupTask: ReturnType<typeof cron.schedule> | null = null;
let staleAutoCoachTask: ReturnType<typeof cron.schedule> | null = null;

// Flags older than this are considered orphaned (worker crashed mid-job).
// 15min gives a comfortable margin above the longest expected auto-coach
// run and well below user-perceived "stuck" thresholds (W5).
const STALE_AUTO_COACHING_THRESHOLD_MS = 15 * 60 * 1000;

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

  // Prune AI usage logs older than 7 days at 04:00 UTC daily.
  aiUsageCleanupTask = cron.schedule(
    "0 4 * * *",
    async () => {
      try {
        const deleted = await storage.aiUsage.deleteExpiredLogs(7);
        if (deleted > 0) {
          logger.info({ context: "cron", deleted }, `AI usage cleanup: removed ${deleted} expired row(s)`);
        }
      } catch (err) {
        logger.error({ context: "cron", err }, "AI usage cleanup failed");
      }
    },
    { timezone: "Etc/UTC" },
  );
  logger.info({ context: "cron" }, "AI usage cleanup scheduled: daily at 04:00 UTC");

  // Recover orphaned isAutoCoaching flags every 10 minutes. Without this,
  // a worker crashing mid-job would leave users stuck seeing "AI Coach
  // thinking…" until the next server restart (W5).
  staleAutoCoachTask = cron.schedule(
    "*/10 * * * *",
    async () => {
      try {
        const reset = await storage.users.resetStaleAutoCoaching(STALE_AUTO_COACHING_THRESHOLD_MS);
        if (reset > 0) {
          logger.warn({ context: "cron", reset }, `Reset ${reset} orphaned isAutoCoaching flag(s)`);
        }
      } catch (err) {
        logger.error({ context: "cron", err }, "Stale isAutoCoaching recovery failed");
      }
    },
    { timezone: "Etc/UTC" },
  );
  logger.info({ context: "cron" }, "Stale isAutoCoaching recovery scheduled: every 10 minutes");

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
  if (aiUsageCleanupTask) {
    const _stop = aiUsageCleanupTask.stop();
    aiUsageCleanupTask = null;
  }
  if (staleAutoCoachTask) {
    const _stop = staleAutoCoachTask.stop();
    staleAutoCoachTask = null;
  }
}

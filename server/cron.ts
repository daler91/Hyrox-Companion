import cron from "node-cron";

import { withPgAdvisoryLock } from "./advisoryLock";
import { pool } from "./db";
import { runEmailCronJob } from "./emailScheduler";
import { logger } from "./logger";
import { queue } from "./queue";
import { runStructuredExerciseDailyRollup } from "./services/structuredExerciseHealth";
import { cleanupExpiredSharedRuntimeState } from "./sharedRuntimeState";
import type { IStorage } from "./storage";

let task: ReturnType<typeof cron.schedule> | null = null;
let idempotencyCleanupTask: ReturnType<typeof cron.schedule> | null = null;
let aiUsageCleanupTask: ReturnType<typeof cron.schedule> | null = null;
let staleAutoCoachTask: ReturnType<typeof cron.schedule> | null = null;
let queueDepthTask: ReturnType<typeof cron.schedule> | null = null;
let structuredExerciseRollupTask: ReturnType<typeof cron.schedule> | null = null;
let sharedRuntimeCleanupTask: ReturnType<typeof cron.schedule> | null = null;

// Flags older than this are considered orphaned (worker crashed mid-job).
// 15min gives a comfortable margin above the longest expected auto-coach
// run and well below user-perceived "stuck" thresholds (W5).
const STALE_AUTO_COACHING_THRESHOLD_MS = 15 * 60 * 1000;

export const CRON_LOCK_KEYS = {
  dailyEmail: 42_010_001n,
  idempotencyCleanup: 42_010_002n,
  aiUsageCleanup: 42_010_003n,
  staleAutoCoaching: 42_010_004n,
  queueDepthTelemetry: 42_010_005n,
  structuredExerciseRollup: 42_010_006n,
  startupEmailCatchUp: 42_010_007n,
  sharedRuntimeCleanup: 42_010_008n,
} as const;

export async function runCronJobWithLock<T>(
  name: keyof typeof CRON_LOCK_KEYS,
  run: () => Promise<T>,
) {
  try {
    return await withPgAdvisoryLock(pool, { key: CRON_LOCK_KEYS[name], name }, run);
  } catch (err) {
    logger.error({ context: "cron", err, job: name }, "Cron advisory lock execution failed");
    return { acquired: false, value: undefined };
  }
}

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
      await runCronJobWithLock("dailyEmail", async () => {
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
      });
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
      await runCronJobWithLock("idempotencyCleanup", async () => {
        try {
          const deleted = await storage.idempotency.cleanupExpired();
          if (deleted > 0) {
            logger.info({ context: "cron", deleted }, `Idempotency cleanup: removed ${deleted} expired row(s)`);
          }
        } catch (err) {
          logger.error({ context: "cron", err }, "Idempotency cleanup failed");
        }
      });
    },
    { timezone: "Etc/UTC" },
  );
  logger.info({ context: "cron" }, "Idempotency cleanup scheduled: daily at 03:30 UTC");

  // Prune AI usage logs older than 7 days at 04:00 UTC daily.
  aiUsageCleanupTask = cron.schedule(
    "0 4 * * *",
    async () => {
      await runCronJobWithLock("aiUsageCleanup", async () => {
        try {
          const deleted = await storage.aiUsage.deleteExpiredLogs(7);
          if (deleted > 0) {
            logger.info({ context: "cron", deleted }, `AI usage cleanup: removed ${deleted} expired row(s)`);
          }
        } catch (err) {
          logger.error({ context: "cron", err }, "AI usage cleanup failed");
        }
      });
    },
    { timezone: "Etc/UTC" },
  );
  logger.info({ context: "cron" }, "AI usage cleanup scheduled: daily at 04:00 UTC");

  sharedRuntimeCleanupTask = cron.schedule(
    "15 4 * * *",
    async () => {
      await runCronJobWithLock("sharedRuntimeCleanup", async () => {
        try {
          const deleted = await cleanupExpiredSharedRuntimeState();
          const totalDeleted = deleted.rateLimitBuckets + deleted.runtimeCache;
          if (totalDeleted > 0) {
            logger.info({ context: "cron", ...deleted }, "Shared runtime state cleanup complete");
          }
        } catch (err) {
          logger.error({ context: "cron", err }, "Shared runtime state cleanup failed");
        }
      });
    },
    { timezone: "Etc/UTC" },
  );
  logger.info({ context: "cron" }, "Shared runtime state cleanup scheduled: daily at 04:15 UTC");

  // Recover orphaned isAutoCoaching flags every 10 minutes. Without this,
  // a worker crashing mid-job would leave users stuck seeing "AI Coach
  // thinking…" until the next server restart (W5).
  staleAutoCoachTask = cron.schedule(
    "*/10 * * * *",
    async () => {
      await runCronJobWithLock("staleAutoCoaching", async () => {
        try {
          const reset = await storage.users.resetStaleAutoCoaching(STALE_AUTO_COACHING_THRESHOLD_MS);
          if (reset > 0) {
            logger.warn({ context: "cron", reset }, `Reset ${reset} orphaned isAutoCoaching flag(s)`);
          }
        } catch (err) {
          logger.error({ context: "cron", err }, "Stale isAutoCoaching recovery failed");
        }
      });
    },
    { timezone: "Etc/UTC" },
  );
  logger.info({ context: "cron" }, "Stale isAutoCoaching recovery scheduled: every 10 minutes");

  // Queue-depth telemetry every 5 minutes (Suggestion-12). Emits a
  // structured info log per queue with deferred/queued/active counts so
  // operators can spot a backlog building up before it hurts users.
  // A deferredCount >100 or activeCount >5 escalates to warn so alerting
  // pipelines can pick it up. Uses queue.getQueues() introduced in
  // pg-boss v10; tolerates absence gracefully for older versions.
  const QUEUE_WARN_DEFERRED = 100;
  const QUEUE_WARN_ACTIVE = 5;
  queueDepthTask = cron.schedule(
    "*/5 * * * *",
    async () => {
      await runCronJobWithLock("queueDepthTelemetry", async () => {
        try {
          type QueueDepth = { name: string; queuedCount?: number; deferredCount?: number; activeCount?: number };
          const queues: QueueDepth[] = await queue.getQueues();
          for (const q of queues) {
            const deferred = q.deferredCount ?? 0;
            const active = q.activeCount ?? 0;
            const queued = q.queuedCount ?? 0;
            const backlogged = deferred > QUEUE_WARN_DEFERRED || active > QUEUE_WARN_ACTIVE;
            const log = backlogged ? logger.warn.bind(logger) : logger.info.bind(logger);
            log(
              {
                context: "queue-depth",
                queue: q.name,
                deferred,
                active,
                queued,
              },
              backlogged ? "pg-boss queue is backlogged" : "pg-boss queue depth",
            );
          }
        } catch (err) {
          logger.error({ context: "cron", err }, "Queue-depth telemetry failed");
        }
      });
    },
    { timezone: "Etc/UTC" },
  );
  logger.info({ context: "cron" }, "Queue-depth telemetry scheduled: every 5 minutes");

  structuredExerciseRollupTask = cron.schedule(
    "10 2 * * *",
    async () => {
      await runCronJobWithLock("structuredExerciseRollup", async () => {
        try {
          const previousUtcDay = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          await runStructuredExerciseDailyRollup(previousUtcDay);
          logger.info({ context: "cron", day: previousUtcDay }, "Structured exercise health rollup complete");
        } catch (err) {
          logger.error({ context: "cron", err }, "Structured exercise health rollup failed");
        }
      });
    },
    { timezone: "UTC" },
  );
  logger.info({ context: "cron" }, "Structured exercise health rollup scheduled: daily at 02:10 UTC");


  // Run a catch-up if the server started after 09:00 UTC (e.g. Railway restart).
  // The idempotency guards in emailScheduler prevent duplicate sends.
  const currentHour = new Date().getUTCHours();
  if (currentHour >= 9) {
    const runCatchUp = async () => {
      await runCronJobWithLock("startupEmailCatchUp", async () => {
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
      });
    };
    setTimeout(() => {
      void runCatchUp().catch((err) => {
        logger.error({ context: "cron", err }, "Startup email catch-up task failed before job execution");
      });
    }, 30_000);
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
  if (queueDepthTask) {
    const _stop = queueDepthTask.stop();
    queueDepthTask = null;
  }
  if (structuredExerciseRollupTask) {
    const _stop = structuredExerciseRollupTask.stop();
    structuredExerciseRollupTask = null;
  }
  if (sharedRuntimeCleanupTask) {
    const _stop = sharedRuntimeCleanupTask.stop();
    sharedRuntimeCleanupTask = null;
  }
}

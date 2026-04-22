import pLimit from "p-limit";
import { type Job,PgBoss } from "pg-boss";

import { processMissedWorkoutReminder,processWeeklySummary } from "./emailScheduler";
import { env } from "./env";
import { logger } from "./logger";
import { triggerAutoCoach } from "./services/coachService";
import { embedCoachingMaterial } from "./services/ragService";
import { storage } from "./storage";

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

export const queue = new PgBoss(env.DATABASE_URL);

/**
 * Default job options for idempotent handlers: retry up to 3 times with
 * exponential backoff, expire after 60 min. Handlers must tolerate being
 * invoked multiple times for the same job (e.g. pure DB reads/writes by
 * materialId, or operations protected by DB-level uniqueness).
 */
export const DEFAULT_JOB_OPTIONS = {
  retryLimit: 3,
  retryBackoff: true,
  expireInMinutes: 60,
} as const;

/**
 * Options for non-idempotent jobs: no retries. Use this for handlers
 * with side effects that cannot be safely replayed (e.g. sending email,
 * where the "sent" marker is persisted after the send and a retry after
 * a post-send DB failure would deliver a duplicate).
 */
export const NO_RETRY_JOB_OPTIONS = {
  retryLimit: 0,
  expireInMinutes: 60,
} as const;

/** Send a job with default retry/expiry options (idempotent handlers). */
export function sendJob(name: string, data: Record<string, unknown>) {
  return queue.send(name, data, DEFAULT_JOB_OPTIONS);
}

/** Send a non-idempotent job (no retries). Use for email-send-like jobs. */
export function sendJobNoRetry(name: string, data: Record<string, unknown>) {
  return queue.send(name, data, NO_RETRY_JOB_OPTIONS);
}

queue.on("error", (error: Error) => {
  logger.error(error, "[pg-boss] error");
});

// Bound in-batch parallelism across all workers. pg-boss may deliver a
// batch of jobs in one callback; processing them with unbounded Promise.all
// floods the DB and downstream APIs under backlog spikes
// (CODEBASE_AUDIT.md §3).
const IN_BATCH_CONCURRENCY = 2;

// Per-job wall-clock timeout. expireInMinutes (60) only expunges the queue
// row — it does not kill the worker, so a hung Gemini / HTTP call would leak
// a worker slot forever (W5). We reject the job promise well before the
// 60min expire so pg-boss sees it as failed and can retry.
//
// Kept deliberately 10 minutes BELOW expire (not 5) so that when the JS
// rejection fires, any orphaned upstream fetch/Gemini call still in Node's
// event loop has time to complete (or time out on its own AbortSignal)
// before pg-boss's expire treats the job as re-dispatchable
// (CODEBASE_AUDIT.md Warning-17).
const JOB_TIMEOUT_MS = 50 * 60 * 1000;

async function runWithTimeout<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<T>([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`[pg-boss] ${label} job exceeded ${JOB_TIMEOUT_MS / 60_000}min timeout`)),
          JOB_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Runs `processJob` against every job in the batch with bounded parallelism
 * and `Promise.allSettled` semantics so a single poison job does not throw
 * away the whole batch. Aggregates failures into a summary error so pg-boss
 * still sees the batch as failed when any job failed (and can retry only
 * the failed ones on the next poll, per pg-boss semantics for batch-work).
 */
async function runBatch<T>(
  queueName: string,
  jobs: Job[],
  processJob: (job: Job) => Promise<T>,
): Promise<void> {
  const limit = pLimit(IN_BATCH_CONCURRENCY);
  const results = await Promise.allSettled(
    jobs.map((job) => limit(() => processJob(job))),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    logger.warn(
      { queue: queueName, failedCount: failed.length, batchSize: jobs.length },
      `[pg-boss] batch had failures`,
    );
    throw new Error(
      `Batch processing failed for ${failed.length}/${jobs.length} ${queueName} jobs`,
    );
  }
}

const QUEUE_START_TIMEOUT_MS = 30_000;

export async function startQueue() {
  logger.info("Starting pg-boss queue...");
  // Clear the timeout timer when the race resolves so we don't leak a
  // pending setTimeout for the full 30s window when queue.start() wins.
  // On timeout or any other start failure, call queue.stop() to release
  // the partially-initialised connection pool — pg-boss opens its pool
  // before returning from start(), so leaving the failed instance alive
  // leaks a DB slot for the process lifetime (Warning-18).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`pg-boss queue.start() timed out after ${QUEUE_START_TIMEOUT_MS / 1000}s — check DATABASE_URL connectivity`)),
      QUEUE_START_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([queue.start(), timeoutPromise]);
  } catch (err) {
    await queue.stop().catch((stopErr) => {
      logger.error({ err: stopErr }, "[pg-boss] queue.stop() after failed start also failed; proceeding with original error");
    });
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }

  await queue.createQueue("auto-coach");
  await queue.createQueue("embed-coaching-material");

  await queue.work("auto-coach", async (jobs: Job[]) => {
    await runBatch("auto-coach", jobs, async (job) => {
      logger.info({ jobId: job.id, data: job.data }, "[pg-boss] Processing auto-coach job");
      try {
        const { userId } = job.data as { userId: string };
        const result = await runWithTimeout("auto-coach", () => triggerAutoCoach(userId));
        logger.info({ jobId: job.id, adjusted: result.adjusted }, "[pg-boss] Completed auto-coach job");
      } catch (error) {
        logger.error({ err: error, jobId: job.id }, "[pg-boss] Failed auto-coach job");
        throw error; // Let pg-boss handle the retry
      }
    });
  });


  // Register worker for embed-coaching-material
  await queue.work("embed-coaching-material", async (jobs: Job[]) => {
    await runBatch("embed-coaching-material", jobs, async (job) => {
      const { materialId, userId } = job.data as { materialId: string; userId: string };
      logger.info({ jobId: job.id, materialId }, "[pg-boss] Processing embed-coaching-material job");
      try {
        const material = await storage.coaching.getCoachingMaterial(materialId, userId);
        if (!material) {
          logger.warn({ jobId: job.id, materialId }, "[pg-boss] Material not found, skipping embed job");
          return;
        }
        await runWithTimeout("embed-coaching-material", () => embedCoachingMaterial(material));
        logger.info({ jobId: job.id, materialId }, "[pg-boss] Completed embed-coaching-material job");
      } catch (error) {
        logger.error({ err: error, jobId: job.id }, "[pg-boss] Failed embed-coaching-material job");
        throw error; // Let pg-boss handle the retry
      }
    });
  });

  // Register worker for send-weekly-summary
  await queue.createQueue("send-weekly-summary");
  await queue.work("send-weekly-summary", async (jobs: Job[]) => {
    await runBatch("send-weekly-summary", jobs, async (job) => {
      const { userId } = job.data as { userId: string };
      logger.info({ jobId: job.id, userId }, "[pg-boss] Processing send-weekly-summary job");
      try {
        const user = await storage.users.getUser(userId);
        if (!user) {
          logger.warn({ jobId: job.id, userId }, "[pg-boss] User not found, skipping send-weekly-summary job");
          return;
        }
        const sent = await runWithTimeout(
          "send-weekly-summary",
          () => processWeeklySummary(storage, user, new Date()),
        );
        logger.info({ jobId: job.id, userId, sent }, "[pg-boss] Completed send-weekly-summary job");
      } catch (error) {
        logger.error({ err: error, jobId: job.id, userId }, "[pg-boss] Failed send-weekly-summary job");
        throw error; // Let pg-boss handle the retry
      }
    });
  });

  // Register worker for send-missed-reminder
  await queue.createQueue("send-missed-reminder");
  await queue.work("send-missed-reminder", async (jobs: Job[]) => {
    await runBatch("send-missed-reminder", jobs, async (job) => {
      const { userId } = job.data as { userId: string };
      logger.info({ jobId: job.id, userId }, "[pg-boss] Processing send-missed-reminder job");
      try {
        const user = await storage.users.getUser(userId);
        if (!user) {
          logger.warn({ jobId: job.id, userId }, "[pg-boss] User not found, skipping send-missed-reminder job");
          return;
        }
        const sent = await runWithTimeout(
          "send-missed-reminder",
          () => processMissedWorkoutReminder(storage, user, new Date()),
        );
        logger.info({ jobId: job.id, userId, sent }, "[pg-boss] Completed send-missed-reminder job");
      } catch (error) {
        logger.error({ err: error, jobId: job.id, userId }, "[pg-boss] Failed send-missed-reminder job");
        throw error; // Let pg-boss handle the retry
      }
    });
  });

  logger.info("pg-boss queue started and workers registered");
}

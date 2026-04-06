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

queue.on("error", (error: Error) => {
  logger.error(error, "[pg-boss] error");
});

// Bound in-batch parallelism across all workers. pg-boss may deliver a
// batch of jobs in one callback; processing them with unbounded Promise.all
// floods the DB and downstream APIs under backlog spikes
// (CODEBASE_AUDIT.md §3).
const IN_BATCH_CONCURRENCY = 2;

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

export async function startQueue() {
  logger.info("Starting pg-boss queue...");
  await queue.start();

  await queue.createQueue("auto-coach");
  await queue.createQueue("embed-coaching-material");

  await queue.work("auto-coach", async (jobs: Job[]) => {
    await runBatch("auto-coach", jobs, async (job) => {
      logger.info({ jobId: job.id, data: job.data }, "[pg-boss] Processing auto-coach job");
      try {
        const { userId } = job.data as { userId: string };
        const result = await triggerAutoCoach(userId);
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
        await embedCoachingMaterial(material);
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
        const sent = await processWeeklySummary(storage, user, new Date());
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
        const sent = await processMissedWorkoutReminder(storage, user, new Date());
        logger.info({ jobId: job.id, userId, sent }, "[pg-boss] Completed send-missed-reminder job");
      } catch (error) {
        logger.error({ err: error, jobId: job.id, userId }, "[pg-boss] Failed send-missed-reminder job");
        throw error; // Let pg-boss handle the retry
      }
    });
  });

  logger.info("pg-boss queue started and workers registered");
}

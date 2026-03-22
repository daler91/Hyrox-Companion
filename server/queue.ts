import { PgBoss, type Job } from "pg-boss";
import { env } from "./env";
import { logger } from "./logger";
import { triggerAutoCoach } from "./services/coachService";

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

export const queue = new PgBoss(env.DATABASE_URL);

queue.on("error", (error: Error) => {
  logger.error(error, "[pg-boss] error");
});

export async function startQueue() {
  logger.info("Starting pg-boss queue...");
  await queue.start();

  // Register worker for auto-coach
  await queue.work("auto-coach", async (jobs: Job[]) => {
    for (const job of jobs) {
      logger.info({ jobId: job.id, data: job.data }, "[pg-boss] Processing auto-coach job");
      try {
        const { userId } = job.data as { userId: string };
        const result = await triggerAutoCoach(userId);
        logger.info({ jobId: job.id, adjusted: result.adjusted }, "[pg-boss] Completed auto-coach job");
      } catch (error) {
        logger.error({ err: error, jobId: job.id }, "[pg-boss] Failed auto-coach job");
        throw error; // Let pg-boss handle the retry
      }
    }
  });

  logger.info("pg-boss queue started and workers registered");
}

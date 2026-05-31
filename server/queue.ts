import { randomUUID } from "node:crypto";

import type { GeneratePlanInput } from "@shared/schema";
import pLimit from "p-limit";
import { type Job,PgBoss } from "pg-boss";

import { PGBOSS_STATEMENT_TIMEOUT_MS } from "./constants";
import { processMissedWorkoutReminder,processWeeklySummary } from "./emailScheduler";
import { env } from "./env";
import { logger } from "./logger";
import { getEmbedJobIdentifiers, getUserIdFromJob } from "./queue.utils";
import { getRequestContext, runWithRequestContext } from "./requestContext";
import { triggerAutoCoach } from "./services/coachService";
import { executePlanGeneration } from "./services/planGenerationService";
import { embedCoachingMaterial } from "./services/ragService";
import { storage } from "./storage";

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

/**
 * Build the pg-boss connection URL with a PG-side `statement_timeout` set on
 * every session pg-boss opens (W12). pg-boss owns its own pool internally
 * (separate from server/db.ts's request pool), so the
 * `DB_STATEMENT_TIMEOUT_MS = 30s` configured there does NOT apply to job
 * handlers — a hung DB query inside a job would otherwise wedge the
 * connection until pg-boss's 60-min `expireInMinutes` reaper noticed.
 *
 * Done via the libpq `options` URL parameter (`-c statement_timeout=...`)
 * because pg-boss's DatabaseOptions interface doesn't expose
 * `statement_timeout` directly and the URL approach works without a
 * custom IDatabase adapter.
 */
export function buildQueueConnectionString(baseUrl: string): string {
  const url = new URL(baseUrl);
  // Preserve any existing `options` the operator may have set, prepended.
  const existing = url.searchParams.get("options");
  const ourOption = `-c statement_timeout=${PGBOSS_STATEMENT_TIMEOUT_MS}`;
  url.searchParams.set("options", existing ? `${existing} ${ourOption}` : ourOption);
  return url.toString();
}

export const queue = new PgBoss(buildQueueConnectionString(env.DATABASE_URL));

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

// Reserved job-payload key carrying the originating request's correlation id
// across the pg-boss boundary (S19) so async-job logs trace back to the request
// that enqueued them.
const TRACE_REQUEST_ID_KEY = "__requestId";

function withTrace(data: Record<string, unknown>): Record<string, unknown> {
  const requestId = getRequestContext()?.requestId;
  return requestId ? { ...data, [TRACE_REQUEST_ID_KEY]: requestId } : data;
}

/** Send a job with default retry/expiry options (idempotent handlers). */
export function sendJob(name: string, data: Record<string, unknown>) {
  return queue.send(name, withTrace(data), DEFAULT_JOB_OPTIONS);
}

/** Send a non-idempotent job (no retries). Use for email-send-like jobs. */
export function sendJobNoRetry(name: string, data: Record<string, unknown>) {
  return queue.send(name, withTrace(data), NO_RETRY_JOB_OPTIONS);
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
// row - it does not kill the worker, so a hung AI / HTTP call would leak
// a worker slot forever (W5). We reject the job promise well before the
// 60min expire so pg-boss sees it as failed and can retry.
//
// Kept deliberately 10 minutes BELOW expire (not 5) so that when the JS
// rejection fires, any orphaned upstream fetch/provider call still in Node's
// event loop has time to complete (or time out on its own AbortSignal)
// before pg-boss's expire treats the job as re-dispatchable
// (CODEBASE_AUDIT.md Warning-17).
const JOB_TIMEOUT_MS = 50 * 60 * 1000;

async function runWithTimeout<T>(
  label: string,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  try {
    return await Promise.race<T>([
      fn(controller.signal),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          // Aborts the signal so downstream callers that accept it
          // (fetch, Gemini SDK, custom AbortSignal listeners) can tear
          // down promptly rather than running to completion after the
          // timeout reject propagates.
          controller.abort();
          reject(new Error(`[pg-boss] ${label} job exceeded ${JOB_TIMEOUT_MS / 60_000}min timeout`));
        }, JOB_TIMEOUT_MS);
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
// Resolve the correlation id for a job: the propagated request id if the job
// was enqueued within a request, else a fresh id so cron-originated jobs are
// still self-correlated (S19).
function jobRequestId(job: Job): string {
  const fromPayload = (job.data as Record<string, unknown> | undefined)?.[TRACE_REQUEST_ID_KEY];
  return typeof fromPayload === "string" && fromPayload.length > 0 ? fromPayload : randomUUID();
}

async function runBatch<T>(
  queueName: string,
  jobs: Job[],
  processJob: (job: Job) => Promise<T>,
): Promise<void> {
  const limit = pLimit(IN_BATCH_CONCURRENCY);
  const results = await Promise.allSettled(
    jobs.map((job) =>
      limit(() => runWithRequestContext({ requestId: jobRequestId(job) }, () => processJob(job))),
    ),
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

async function requireUserFromJob(job: Job, queueName: string) {
  const userId = getUserIdFromJob(job);
  if (!userId) {
    logger.warn({ jobId: job.id, data: job.data }, `[pg-boss] Missing userId on ${queueName} job, skipping`);
    return null;
  }

  const user = await storage.users.getUser(userId);
  if (!user) {
    logger.warn({ jobId: job.id, userId }, `[pg-boss] User not found, skipping ${queueName} job`);
    return null;
  }

  return { userId, user };
}

async function registerUserEmailWorker({
  queueName,
  process,
}: {
  readonly queueName: "send-weekly-summary" | "send-missed-reminder";
  readonly process: (context: Awaited<ReturnType<typeof requireUserFromJob>>) => Promise<boolean>;
}) {
  await queue.createQueue(queueName);
  await queue.work(queueName, async (jobs: Job[]) => {
    await runBatch(queueName, jobs, async (job) => {
      logger.info({ jobId: job.id }, `[pg-boss] Processing ${queueName} job`);
      try {
        const userContext = await requireUserFromJob(job, queueName);
        if (!userContext) return;

        const sent = await runWithTimeout(queueName, () => process(userContext));
        logger.info({ jobId: job.id, userId: userContext.userId, sent }, `[pg-boss] Completed ${queueName} job`);
      } catch (error) {
        logger.error({ err: error, jobId: job.id }, `[pg-boss] Failed ${queueName} job`);
        throw error;
      }
    });
  });
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
        const userId = getUserIdFromJob(job);
        if (!userId) {
          logger.warn({ jobId: job.id, data: job.data }, "[pg-boss] Missing userId on auto-coach job, skipping");
          return;
        }
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
      const identifiers = getEmbedJobIdentifiers(job);
      if (!identifiers) {
        logger.warn({ jobId: job.id, data: job.data }, "[pg-boss] Missing embed-coaching-material identifiers, skipping");
        return;
      }
      const { materialId, userId } = identifiers;
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

  await registerUserEmailWorker({
    queueName: "send-weekly-summary",
    process: async (context) =>
      context ? processWeeklySummary(storage, context.user, new Date()) : false,
  });

  await registerUserEmailWorker({
    queueName: "send-missed-reminder",
    process: async (context) =>
      context ? processMissedWorkoutReminder(storage, context.user, new Date()) : false,
  });

  await queue.createQueue("plan-generation");
  await queue.work("plan-generation", async (jobs: Job[]) => {
    await runBatch("plan-generation", jobs, async (job) => {
      const { planId, userId, input } = job.data as { planId: string; userId: string; input: GeneratePlanInput };
      logger.info({ jobId: job.id, planId, userId }, "[pg-boss] Processing plan-generation job");
      try {
        await runWithTimeout("plan-generation", (signal) =>
          executePlanGeneration(planId, input, userId, signal),
        );
        logger.info({ jobId: job.id, planId }, "[pg-boss] Completed plan-generation job");
      } catch (error) {
        logger.error({ err: error, jobId: job.id, planId }, "[pg-boss] Failed plan-generation job");
        throw error;
      }
    });
  });

  logger.info("pg-boss queue started and workers registered");
}

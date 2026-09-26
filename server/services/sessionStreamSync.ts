/**
 * Worker side of the session-stream fetcher, plus its backfill scan.
 *
 * Session grading ("did the session do its job?") needs a run's heart rate
 * and pace over time, which Strava serves as one `/streams` read per activity.
 * This fetches that stream for plan-linked runs whose purpose we grade, folds
 * it into 15-second buckets (sessionGrades/downsample.ts) and stores the
 * result on `workout_log_streams`. Grades themselves are computed on read.
 *
 * Every read here comes out of the same app-wide Strava budget the activity
 * sync lives on (100 reads per 15 minutes, 1000 per day, shared by every
 * athlete — see stravaAutoSync.ts). So stream fetching takes a deliberately
 * small, capped share: a few runs per job, a few athletes per scan tick, a
 * soft ledger counted from the table itself, and the activity sync's own 429
 * cooldown, which a throttled stream read also arms.
 */
import { addDaysToISODate, toIsoDateUtc } from "@shared/dateUtils";
import { isRunSportType } from "@shared/deviceSportTypes";
import { classifyRunPurpose, gradingIntentFor } from "@shared/sessionIntent";
import type { Job } from "pg-boss";

import { logger } from "../logger";
import { jobDataKeys, queue, runBatch, runWithTimeout } from "../queue";
import { getUserIdFromJob } from "../queue.utils";
import type { IStorage } from "../storage";
import type { PendingStreamCandidate, PendingStreamWindow } from "../storage/sessionStreams";
import { fetchStravaActivityStreams, getValidAccessToken } from "../strava";
import { SESSION_STREAM_BACKFILL_DAYS, SESSION_STREAM_MAX_ATTEMPTS } from "./sessionGrades/constants";
import { downsampleStravaStreams } from "./sessionGrades/downsample";
import {
  enqueueSessionStreams,
  SESSION_STREAMS_QUEUE,
  type SessionStreamJobData,
  type SessionStreamTrigger,
} from "./sessionStreamQueue";
import { getStravaSyncCooldownUntil, startStravaSyncCooldown } from "./stravaAutoSync";
import { isStravaAutoSyncEnabled } from "./stravaSyncQueue";

const LOG_CTX = "session-streams" as const;

/** Most streams one job fetches. A sync that links more leaves the rest to the scan. */
export const SESSION_STREAMS_PER_JOB = 5;
/**
 * Soft share of Strava's 100 reads per 15 minutes. Leaves 80 for the activity
 * syncs (one list read per athlete plus detail reads), which the athlete is
 * waiting on; a stream can always wait for the next window.
 */
export const SESSION_STREAM_READS_PER_15_MIN = 20;
/**
 * Soft share of the 1000 reads per day. The polling sync costs about 24 reads
 * per connected athlete per day at its default hourly interval, so the day
 * budget is the tighter one; 250 still drains a new athlete's six-month
 * backlog of graded runs within a day or two.
 */
export const SESSION_STREAM_READS_PER_DAY = 250;
/** 3 athletes × 5 streams = 15 reads per tick, inside the 20 even with an empty ledger. */
export const SESSION_STREAM_SCAN_USERS_PER_TICK = 3;
/** How long a failed fetch waits before it is tried again. */
export const SESSION_STREAM_RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
/** Candidates loaded per job — more than it fetches, since some are skipped without a read. */
const CANDIDATES_PER_JOB = 20;
const QUARTER_HOUR_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type SessionStreamJobResult =
  | { status: "done"; fetched: number; skipped: number; failed: number }
  | { status: "disabled" | "cooldown" | "budget" | "not_connected" | "reauth_required" | "transient" }
  | { status: "rate_limited"; cooldownUntil: number };

type JobLogger = Pick<typeof logger, "info" | "warn" | "error">;

function pendingWindow(now: Date, limit: number): PendingStreamWindow {
  // A six-month cutoff does not care which timezone's calendar day it starts on.
  return {
    since: addDaysToISODate(toIsoDateUtc(now), -SESSION_STREAM_BACKFILL_DAYS),
    retryBefore: new Date(now.getTime() - SESSION_STREAM_RETRY_AFTER_MS),
    maxAttempts: SESSION_STREAM_MAX_ATTEMPTS,
    limit,
  };
}

/** Reads left in both budget windows (the smaller of the two). */
async function remainingReadBudget(storage: IStorage, now: Date): Promise<number> {
  const [quarterHour, day] = await Promise.all([
    storage.sessionStreams.countAttemptsSince(new Date(now.getTime() - QUARTER_HOUR_MS)),
    storage.sessionStreams.countAttemptsSince(new Date(now.getTime() - DAY_MS)),
  ]);
  return Math.max(
    0,
    Math.min(SESSION_STREAM_READS_PER_15_MIN - quarterHour, SESSION_STREAM_READS_PER_DAY - day),
  );
}

/** Whether this run is one we grade — decided before any Strava read is spent on it. */
function isGradeableRun(candidate: PendingStreamCandidate, exerciseNames: readonly string[]): boolean {
  const sportType = candidate.deviceActivity?.raw.sport_type ?? candidate.logFocus;
  if (!isRunSportType(sportType)) return false;
  const purpose = classifyRunPurpose({
    focus: candidate.planFocus,
    mainWorkout: candidate.planMainWorkout,
    exerciseNames,
  });
  return gradingIntentFor(purpose.purpose) !== null;
}

type FetchOutcome =
  | { kind: "stored"; failed: boolean }
  | { kind: "stop"; result: SessionStreamJobResult };

async function fetchOne(
  storage: IStorage,
  userId: string,
  accessToken: string,
  candidate: PendingStreamCandidate,
): Promise<FetchOutcome> {
  const base = {
    userId,
    workoutLogId: candidate.workoutLogId,
    stravaActivityId: candidate.stravaActivityId,
  };
  const fetched = await fetchStravaActivityStreams(accessToken, candidate.stravaActivityId);
  if (fetched.ok) {
    const { status, samples } = downsampleStravaStreams(fetched.streams);
    await storage.sessionStreams.upsertResult({
      ...base,
      status,
      samples,
      attempts: candidate.attempts,
      lastError: null,
    });
    return { kind: "stored", failed: false };
  }
  switch (fetched.reason) {
    case "not_found":
      await storage.sessionStreams.upsertResult({
        ...base,
        status: "unavailable",
        samples: null,
        attempts: candidate.attempts,
        lastError: "http_404",
      });
      return { kind: "stored", failed: false };
    case "failed":
      await storage.sessionStreams.upsertResult({
        ...base,
        status: "failed",
        samples: null,
        attempts: candidate.attempts + 1,
        lastError: fetched.status === null ? "network" : `http_${fetched.status}`,
      });
      return { kind: "stored", failed: true };
    case "reauth_required":
      // Same tombstone the activity sync writes: Settings offers Reconnect,
      // and the scan's query skips the connection until then.
      await storage.users.setStravaReauthRequired(userId);
      return { kind: "stop", result: { status: "reauth_required" } };
    case "rate_limited": {
      // Not this activity's fault, so no attempt is recorded against it.
      const cooldownUntil = await startStravaSyncCooldown(fetched.retryAfterSeconds);
      return { kind: "stop", result: { status: "rate_limited", cooldownUntil } };
    }
  }
}

/**
 * One athlete's pending streams, newest first, up to the per-job cap and the
 * remaining read budget. Strava-side failures are absorbed into row statuses
 * rather than thrown; only unexpected (DB) errors propagate for pg-boss to
 * retry.
 */
export async function runSessionStreamJob(
  storage: IStorage,
  data: SessionStreamJobData,
  log: JobLogger,
  now: Date = new Date(),
): Promise<SessionStreamJobResult> {
  if (!isStravaAutoSyncEnabled()) return { status: "disabled" };
  if ((await getStravaSyncCooldownUntil()) !== null) return { status: "cooldown" };
  let budget = await remainingReadBudget(storage, now);
  if (budget <= 0) return { status: "budget" };

  const candidates = await storage.sessionStreams.listPendingForUser(
    data.userId,
    pendingWindow(now, CANDIDATES_PER_JOB),
  );
  if (candidates.length === 0) return { status: "done", fetched: 0, skipped: 0, failed: 0 };

  const token = await getValidAccessToken(data.userId);
  if (!token.ok) return { status: token.reason };

  const setsByDay = await storage.workouts.getExerciseSetsByPlanDays(
    [...new Set(candidates.map((candidate) => candidate.planDayId))],
    data.userId,
  );

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  for (const candidate of candidates) {
    if (fetched >= SESSION_STREAMS_PER_JOB || budget <= 0) break;
    const exerciseNames = (setsByDay.get(candidate.planDayId) ?? []).map((set) => set.exerciseName);
    if (!isGradeableRun(candidate, exerciseNames)) {
      await storage.sessionStreams.upsertResult({
        userId: data.userId,
        workoutLogId: candidate.workoutLogId,
        stravaActivityId: candidate.stravaActivityId,
        status: "skipped",
        samples: null,
        attempts: 0,
        lastError: null,
      });
      skipped += 1;
      continue;
    }
    const outcome = await fetchOne(storage, data.userId, token.accessToken, candidate);
    if (outcome.kind === "stop") {
      // Status and timestamps only; no PII or token material.
      // bearer:disable javascript_lang_logger_leak
      log.warn({ context: LOG_CTX, status: outcome.result.status }, "Session stream fetch stopped early");
      return outcome.result;
    }
    fetched += 1;
    budget -= 1;
    if (outcome.failed) failed += 1;
  }
  return { status: "done", fetched, skipped, failed };
}

export interface SessionStreamScanResult {
  usersChecked: number;
  enqueued: number;
  skipped: "disabled" | "cooldown" | "budget" | null;
}

/**
 * The backfill tick: queue a fetch job for a few athletes whose graded runs
 * still lack a stream — runs linked before this feature existed, and runs a
 * job's per-run cap left for later. Most recently active athletes first.
 */
export async function runSessionStreamBackfillScan(
  storage: IStorage,
  now: Date = new Date(),
): Promise<SessionStreamScanResult> {
  if (!isStravaAutoSyncEnabled()) return { usersChecked: 0, enqueued: 0, skipped: "disabled" };
  if ((await getStravaSyncCooldownUntil()) !== null) {
    return { usersChecked: 0, enqueued: 0, skipped: "cooldown" };
  }
  if ((await remainingReadBudget(storage, now)) <= 0) {
    return { usersChecked: 0, enqueued: 0, skipped: "budget" };
  }
  const userIds = await storage.sessionStreams.listUsersWithPendingStreams(
    pendingWindow(now, SESSION_STREAM_SCAN_USERS_PER_TICK),
  );
  let enqueued = 0;
  for (const userId of userIds) {
    const result = await enqueueSessionStreams(userId, "scan");
    if (result.enqueued) enqueued += 1;
  }
  return { usersChecked: userIds.length, enqueued, skipped: null };
}

/**
 * Register the `session-streams` worker. Called from server/index.ts next to
 * the Strava auto-sync worker, for the same import-cycle reason: this module
 * reaches the Strava engine in server/strava.ts.
 */
export async function registerSessionStreamWorker(storage: IStorage): Promise<void> {
  await queue.createQueue(SESSION_STREAMS_QUEUE);
  await queue.work(SESSION_STREAMS_QUEUE, async (jobs: Job[]) => {
    await runBatch(SESSION_STREAMS_QUEUE, jobs, async (job) => {
      const userId = getUserIdFromJob(job);
      if (!userId) {
        // jobId is a pg-boss UUID and dataKeys are field NAMES; no PII.
        // bearer:disable javascript_lang_logger_leak
        logger.warn(
          { jobId: job.id, dataKeys: jobDataKeys(job) },
          "[pg-boss] Missing userId on session-streams job, skipping",
        );
        return;
      }
      const { trigger = "scan" } = job.data as Partial<{ trigger: SessionStreamTrigger }>;
      // jobId is a UUID bound as log context; no PII.
      // bearer:disable javascript_lang_logger_leak
      const log = logger.child({ jobId: job.id, context: LOG_CTX });
      try {
        const result = await runWithTimeout(SESSION_STREAMS_QUEUE, () =>
          runSessionStreamJob(storage, { userId, trigger }, log),
        );
        // Status, trigger and counts only.
        // bearer:disable javascript_lang_logger_leak
        log.info({ ...result, trigger }, "[pg-boss] Completed session-streams job");
      } catch (error) {
        // err is a DB error bound to a jobId child logger; no PII.
        // bearer:disable javascript_lang_logger_leak
        log.error({ err: error }, "[pg-boss] Failed session-streams job");
        throw error; // Let pg-boss handle the retry
      }
    });
  });
}

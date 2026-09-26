/**
 * Producer side of the session-stream fetcher.
 *
 * Every path that may have made a run gradeable — a Strava sync that linked a
 * recording to a plan day, a manual link, the athlete opening a run whose
 * stream is still pending, the backfill scan — goes through
 * enqueueSessionStreams, which coalesces bursts into at most one job per
 * athlete per debounce window. The worker (services/sessionStreamSync.ts)
 * reads the database for what is still pending, so the job carries no log
 * ids and a duplicate is harmless.
 *
 * Split from the worker for the same reason as stravaSyncQueue.ts: the
 * modules that enqueue (server/strava.ts, the workout routes) must not import
 * the Strava engine the worker uses, or an import cycle forms through
 * server/queue.ts.
 */
import { DEFAULT_JOB_OPTIONS, queue, withTrace } from "../queue";
import { isStravaAutoSyncEnabled } from "./stravaSyncQueue";

export const SESSION_STREAMS_QUEUE = "session-streams";

export type SessionStreamTrigger = "sync" | "link" | "assign" | "scan" | "read";

export interface SessionStreamJobData {
  /** Top-level so purgeUserJobs (account erasure) reaches these rows too. */
  userId: string;
  trigger: SessionStreamTrigger;
}

/**
 * One job per athlete per minute: a sync that links three runs, followed by
 * the athlete opening one of them, is a single job.
 */
export const SESSION_STREAMS_DEBOUNCE_SECONDS = 60;

export interface EnqueueSessionStreamsResult {
  /** False when the kill switch is off or the debounce window already holds a job. */
  enqueued: boolean;
  jobId: string | null;
}

/**
 * Stream fetches are background Strava reads, so the auto-sync kill switch
 * (STRAVA_AUTO_SYNC_ENABLED=false) turns them off too; grades then fall back
 * to the summary metrics.
 */
export async function enqueueSessionStreams(
  userId: string,
  trigger: SessionStreamTrigger,
): Promise<EnqueueSessionStreamsResult> {
  if (!isStravaAutoSyncEnabled()) return { enqueued: false, jobId: null };
  const data: SessionStreamJobData = { userId, trigger };
  const jobId = await queue.sendDebounced(
    SESSION_STREAMS_QUEUE,
    withTrace({ ...data }),
    DEFAULT_JOB_OPTIONS,
    SESSION_STREAMS_DEBOUNCE_SECONDS,
    `session-streams:${userId}`,
  );
  return { enqueued: jobId !== null, jobId };
}

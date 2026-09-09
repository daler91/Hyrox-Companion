/**
 * Producer side of the automatic Strava sync.
 *
 * Every path that wants an athlete's Strava activities pulled in the
 * background — a webhook event, the polling fallback, the moment they connect
 * — goes through enqueueStravaSync, which coalesces bursts into at most one
 * job per athlete per debounce window. The worker lives in
 * services/stravaAutoSync.ts. The two are split so the modules that enqueue
 * (the OAuth callback in server/strava.ts, the webhook receiver in
 * server/stravaWebhook.ts) never import the sync engine, and no import cycle
 * forms through server/queue.ts.
 */
import { env } from "../env";
import { DEFAULT_JOB_OPTIONS, queue, withTrace } from "../queue";

export const STRAVA_SYNC_QUEUE = "strava-sync";

export type StravaSyncTrigger = "webhook" | "poll" | "connect";

export interface StravaSyncJobData {
  /** Top-level so purgeUserJobs (account erasure) reaches these rows too. */
  userId: string;
  trigger: StravaSyncTrigger;
}

/**
 * Debounce window per athlete, in seconds. A Strava upload typically fires a
 * `create` event followed by one or more `update`s seconds apart (title,
 * sport type); one incremental sync covers all of them. pg-boss's debounce
 * keeps at most one job per athlete per window and, when another request
 * lands inside a window whose job already exists (queued, running or done),
 * schedules exactly one more run in the next window — so an activity that
 * finished uploading after the running sync listed activities is never lost.
 */
export const STRAVA_SYNC_DEBOUNCE_SECONDS = 60;

/** Master kill switch: STRAVA_AUTO_SYNC_ENABLED=false leaves only the manual Sync button. */
export function isStravaAutoSyncEnabled(): boolean {
  return env.STRAVA_AUTO_SYNC_ENABLED !== "false";
}

/** Polling fallback: how stale last_synced_at may get before a re-sync. */
export function getStravaAutoSyncIntervalMs(): number {
  const minutes = env.STRAVA_AUTO_SYNC_INTERVAL_MINUTES ?? 60;
  return minutes * 60_000;
}

export interface EnqueueStravaSyncResult {
  /** False when the kill switch is off or the debounce window already holds a job. */
  enqueued: boolean;
  jobId: string | null;
}

export async function enqueueStravaSync(
  userId: string,
  trigger: StravaSyncTrigger,
): Promise<EnqueueStravaSyncResult> {
  if (!isStravaAutoSyncEnabled()) return { enqueued: false, jobId: null };
  const data: StravaSyncJobData = { userId, trigger };
  const jobId = await queue.sendDebounced(
    STRAVA_SYNC_QUEUE,
    withTrace({ ...data }),
    DEFAULT_JOB_OPTIONS,
    STRAVA_SYNC_DEBOUNCE_SECONDS,
    `strava-sync:${userId}`,
  );
  return { enqueued: jobId !== null, jobId };
}

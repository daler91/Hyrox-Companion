/**
 * Worker side of the automatic Strava sync, plus the polling fallback.
 *
 * Two producers feed the `strava-sync` queue (see stravaSyncQueue.ts): the
 * webhook receiver, which reacts within a minute of an upload, and the scan
 * below, which the cron runs every 15 minutes to catch everything the push
 * path cannot — deployments without a public https APP_URL, an event Strava
 * dropped, a job that ran into a transient failure. Both go through the one
 * engine behind the manual Sync button, syncStravaForUser, so a background
 * import lands exactly as a manual one would.
 *
 * Strava meters the whole application, not each athlete: 100 read requests
 * per 15 minutes and 1000 per day, shared by every connected athlete and
 * every manual Sync. Everything here is shaped by that budget — the per-tick
 * cap on the scan, the stalest-first ordering, and the shared cooldown that
 * a single 429 puts every background sync into.
 */
import type { Job } from "pg-boss";

import { logger } from "../logger";
import { jobDataKeys, queue, runBatch, runWithTimeout } from "../queue";
import { getUserIdFromJob } from "../queue.utils";
import { getRuntimeCache, setRuntimeCache } from "../sharedRuntimeState";
import type { IStorage } from "../storage";
import { type StravaSyncCounts, syncStravaForUser } from "../strava";
import {
  enqueueStravaSync,
  getStravaAutoSyncIntervalMs,
  isStravaAutoSyncEnabled,
  STRAVA_SYNC_QUEUE,
  type StravaSyncJobData,
  type StravaSyncTrigger,
} from "./stravaSyncQueue";

const LOG_CTX = "strava-auto-sync" as const;

/**
 * Most athletes the polling scan may enqueue per 15-minute tick. Each sync
 * costs one activities read when nothing is new (plus one detail read per
 * newly imported activity, capped at 25), so ten per tick keeps the fallback
 * under 40 reads an hour — inside the 100-per-15-minutes window even when
 * the webhook path and manual syncs are busy too. Stalest-first ordering
 * means a user base larger than the cap is served in rotation rather than
 * some athletes never at all.
 */
export const STRAVA_AUTO_SYNC_MAX_USERS_PER_TICK = 10;

// One shared cooldown for every background sync. Strava's read budget is
// metered in 15-minute windows and it answers a 429 with no Retry-After more
// often than not, so an exhausted window is waited out in full.
const STRAVA_SYNC_COOLDOWN_CACHE_KEY = "strava:sync-cooldown";
export const STRAVA_SYNC_MIN_COOLDOWN_MS = 15 * 60 * 1000;

interface StravaSyncCooldown {
  /** Epoch ms. */
  until: number;
}

/** Epoch ms until which background syncs stay paused after a 429, or null. */
export async function getStravaSyncCooldownUntil(): Promise<number | null> {
  try {
    const cooldown = await getRuntimeCache<StravaSyncCooldown>(STRAVA_SYNC_COOLDOWN_CACHE_KEY);
    return cooldown && cooldown.until > Date.now() ? cooldown.until : null;
  } catch (err) {
    // A shared-cache blip should not stop syncing; the 429 handling below
    // re-arms the cooldown if Strava is in fact still throttling.
    logger.debug({ context: LOG_CTX, err }, "Failed to read the Strava sync cooldown");
    return null;
  }
}

async function startStravaSyncCooldown(retryAfterSeconds: number): Promise<number> {
  const durationMs = Math.max(retryAfterSeconds * 1000, STRAVA_SYNC_MIN_COOLDOWN_MS);
  const until = Date.now() + durationMs;
  try {
    await setRuntimeCache(
      STRAVA_SYNC_COOLDOWN_CACHE_KEY,
      { until } satisfies StravaSyncCooldown,
      durationMs,
    );
  } catch (err) {
    // err is a shared-cache (DB) error; no PII or token material.
    // bearer:disable javascript_lang_logger_leak
    logger.warn({ context: LOG_CTX, err }, "Failed to persist the Strava sync cooldown");
  }
  return until;
}

export type StravaSyncJobResult =
  | { status: "synced"; trigger: StravaSyncTrigger; counts: StravaSyncCounts }
  | { status: "disabled" | "cooldown" | "not_connected" | "reauth_required" | "transient" }
  | { status: "rate_limited"; cooldownUntil: number };

type JobLogger = Pick<typeof logger, "info" | "warn" | "error">;

/**
 * One background sync. Strava-side failures are absorbed here rather than
 * thrown: the connection's cursor is untouched, so the next scan simply picks
 * the athlete up again. Letting pg-boss retry instead would spend budget on
 * the same throttled or flaky upstream seconds later. Anything unexpected (a
 * DB failure) does propagate, and pg-boss retries it with backoff.
 */
export async function runStravaSyncJob(
  data: StravaSyncJobData,
  log: JobLogger,
): Promise<StravaSyncJobResult> {
  if (!isStravaAutoSyncEnabled()) return { status: "disabled" };

  const cooldownUntil = await getStravaSyncCooldownUntil();
  if (cooldownUntil !== null) {
    // Timestamp only; no PII.
    // bearer:disable javascript_lang_logger_leak
    log.info(
      { context: LOG_CTX, cooldownUntil },
      "Skipping Strava sync: rate-limit cooldown in force",
    );
    return { status: "cooldown" };
  }

  const outcome = await syncStravaForUser(data.userId, log);
  if (outcome.ok) {
    const { ok: _ok, ...counts } = outcome;
    return { status: "synced", trigger: data.trigger, counts };
  }

  switch (outcome.reason) {
    case "rate_limited": {
      const until = await startStravaSyncCooldown(outcome.retryAfterSeconds);
      // Timestamp only; no PII.
      // bearer:disable javascript_lang_logger_leak
      log.warn(
        { context: LOG_CTX, cooldownUntil: until },
        "Strava rate-limited the app — pausing background syncs",
      );
      return { status: "rate_limited", cooldownUntil: until };
    }
    case "reauth_required":
      // The connection is tombstoned; Settings now offers Reconnect, and the
      // scan's query excludes the row until then.
      // Internal user id only, for support triage; no PII or token material.
      // bearer:disable javascript_lang_logger_leak
      log.warn(
        { context: LOG_CTX, userId: data.userId },
        "Strava access revoked — athlete must reconnect",
      );
      return { status: "reauth_required" };
    case "not_connected":
      // Disconnected between enqueue and run.
      return { status: "not_connected" };
    case "transient":
      // Internal user id only, for support triage; no PII or token material.
      // bearer:disable javascript_lang_logger_leak
      log.warn(
        { context: LOG_CTX, userId: data.userId },
        "Strava sync hit a transient failure; the next scan retries",
      );
      return { status: "transient" };
  }
}

export interface StravaAutoSyncScanResult {
  /** Due connections found (after the per-tick cap). */
  usersChecked: number;
  /** Jobs actually queued; the rest were coalesced into a job already pending. */
  enqueued: number;
  skipped: "disabled" | "cooldown" | null;
}

/**
 * The polling fallback's tick: queue a sync for every connection whose
 * cursor is older than STRAVA_AUTO_SYNC_INTERVAL_MINUTES (never-synced ones
 * first, then stalest first), up to the per-tick cap. A connection that just
 * connected has a null cursor and is picked up here too if its post-connect
 * job was lost.
 */
export async function runStravaAutoSyncScan(
  storage: IStorage,
  now: Date,
): Promise<StravaAutoSyncScanResult> {
  if (!isStravaAutoSyncEnabled()) return { usersChecked: 0, enqueued: 0, skipped: "disabled" };
  if ((await getStravaSyncCooldownUntil()) !== null) {
    return { usersChecked: 0, enqueued: 0, skipped: "cooldown" };
  }

  const staleBefore = new Date(now.getTime() - getStravaAutoSyncIntervalMs());
  const due = await storage.users.listStravaConnectionsDueForSync(
    staleBefore,
    STRAVA_AUTO_SYNC_MAX_USERS_PER_TICK,
  );

  let enqueued = 0;
  for (const connection of due) {
    const result = await enqueueStravaSync(connection.userId, "poll");
    if (result.enqueued) enqueued += 1;
  }
  return { usersChecked: due.length, enqueued, skipped: null };
}

/**
 * Register the `strava-sync` worker. Called from server/index.ts right after
 * startQueue() rather than inside it: this module imports the sync engine in
 * server/strava.ts, and server/queue.ts must stay importable from the
 * producers that engine module uses (stravaSyncQueue.ts) without a cycle.
 */
export async function registerStravaAutoSyncWorker(): Promise<void> {
  await queue.createQueue(STRAVA_SYNC_QUEUE);
  await queue.work(STRAVA_SYNC_QUEUE, async (jobs: Job[]) => {
    await runBatch(STRAVA_SYNC_QUEUE, jobs, async (job) => {
      const userId = getUserIdFromJob(job);
      if (!userId) {
        // jobId is a pg-boss UUID and dataKeys are field NAMES; no PII.
        // bearer:disable javascript_lang_logger_leak
        logger.warn(
          { jobId: job.id, dataKeys: jobDataKeys(job) },
          "[pg-boss] Missing userId on strava-sync job, skipping",
        );
        return;
      }
      const { trigger = "poll" } = job.data as Partial<StravaSyncJobData>;
      // jobId is a UUID bound as log context; no PII.
      // bearer:disable javascript_lang_logger_leak
      const log = logger.child({ jobId: job.id, context: LOG_CTX });
      try {
        const result = await runWithTimeout(STRAVA_SYNC_QUEUE, () =>
          runStravaSyncJob({ userId, trigger }, log),
        );
        // Status, trigger and import counts only.
        // bearer:disable javascript_lang_logger_leak
        log.info(
          { status: result.status, trigger, ...(result.status === "synced" ? result.counts : {}) },
          "[pg-boss] Completed strava-sync job",
        );
      } catch (error) {
        // err is a DB/upstream error bound to a jobId child logger; no PII.
        // bearer:disable javascript_lang_logger_leak
        log.error({ err: error }, "[pg-boss] Failed strava-sync job");
        throw error; // Let pg-boss handle the retry
      }
    });
  });
}

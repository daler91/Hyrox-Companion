import { logger } from "./logger";

// S18 — a lock held longer than this likely means a job is hung (a blocked
// worker, a stuck query). Surface it at warn so alerting can catch jobs that
// pin the lock and starve subsequent runs.
const LOCK_HOLD_WARN_MS = 5 * 60 * 1000;

interface AdvisoryLockClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
  release(): void;
}

export interface AdvisoryLockPool {
  connect(): Promise<AdvisoryLockClient>;
}

export type AdvisoryLockResult<T> =
  | { acquired: true; value: T }
  | { acquired: false; value: undefined };

export async function withPgAdvisoryLock<T>(
  dbPool: AdvisoryLockPool,
  options: { key: bigint; name: string },
  run: () => Promise<T>,
): Promise<AdvisoryLockResult<T>> {
  const client = await dbPool.connect();
  const key = options.key.toString();
  let acquired = false;
  let heldStart = 0;

  try {
    const lockResult = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
      [key],
    );
    acquired = lockResult.rows[0]?.acquired === true;

    if (!acquired) {
      logger.info(
        { context: "advisory-lock", lockName: options.name, lockKey: key },
        "Advisory lock already held; skipping protected work",
      );
      return { acquired: false, value: undefined };
    }

    heldStart = Date.now();
    return { acquired: true, value: await run() };
  } finally {
    if (acquired) {
      // S18: record how long the protected work held the lock; escalate past
      // the threshold so a hung job is visible to alerting.
      const heldMs = Date.now() - heldStart;
      if (heldMs > LOCK_HOLD_WARN_MS) {
        // bearer:disable javascript_lang_logger_leak — lockName/lockKey are
        // operational constants and heldMs is a duration; no PII or secrets.
        logger.warn(
          { context: "advisory-lock", lockName: options.name, lockKey: key, heldMs },
          "Advisory lock held longer than expected",
        );
      } else {
        // bearer:disable javascript_lang_logger_leak — same rationale as the
        // warn branch above: only lockName/lockKey (operational constants) and
        // heldMs (a duration) are logged; no PII or secret material.
        logger.info(
          { context: "advisory-lock", lockName: options.name, lockKey: key, heldMs },
          "Advisory lock released",
        );
      }
      try {
        await client.query("SELECT pg_advisory_unlock($1::bigint) AS released", [key]);
      } catch (err) {
        logger.error(
          { context: "advisory-lock", err, lockName: options.name, lockKey: key },
          "Failed to release advisory lock",
        );
        // Fallback (W16): a transient unlock failure (network blip, txn
        // state surprise) would otherwise leave the lock pinned to this
        // session until PG reaps it — usually many minutes — and any
        // subsequent caller asking for the same lock would silently skip
        // its protected work. pg_advisory_unlock_all() releases every
        // advisory lock held by this session, which is safe here because
        // we're about to release the client back to the pool anyway and
        // we don't hold any other locks on this session.
        try {
          await client.query("SELECT pg_advisory_unlock_all()");
          // bearer:disable javascript_lang_logger_leak — `lockName` and `lockKey`
          // are operational constants (cron-job names + numeric advisory-lock
          // keys defined in server/cron.ts CRON_LOCK_KEYS); no PII or secret
          // material flows through this log line. Matches the existing
          // unflagged pattern in cron.ts.
          logger.warn(
            { context: "advisory-lock", lockName: options.name, lockKey: key, recovered: true },
            "Targeted unlock failed; released all session locks as fallback",
          );
        } catch (fallbackErr) {
          // bearer:disable javascript_lang_logger_leak — same rationale as above.
          logger.error(
            { context: "advisory-lock", err: fallbackErr, lockName: options.name, lockKey: key },
            "pg_advisory_unlock_all() fallback also failed; lock may remain held until PG session reap",
          );
        }
      }
    }
    client.release();
  }
}

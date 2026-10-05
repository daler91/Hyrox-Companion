import { inSequence } from "@shared/inSequence";
import { garminConnections, stravaConnections } from "@shared/schema";
import { and, type AnyColumn, eq, isNull, type SQL } from "drizzle-orm";

import { withPgAdvisoryLock } from "../advisoryLock";
import { currentKeyVersion, reencryptToken } from "../crypto";
import { db, pool } from "../db";
import { env } from "../env";
import { logger } from "../logger";

// Distinct from CRON_LOCK_KEYS in server/cron.ts and MIGRATION_ADVISORY_LOCK_KEY
// in server/maintenance.ts (registry documented above CRON_LOCK_KEYS) so the
// startup re-encrypt sweep never collides with a concurrently-running job.
const KEY_ROTATION_LOCK_KEY = 42_010_009n;

export interface ReencryptSummary {
  stravaUpdated: number;
  garminUpdated: number;
  /** Rows that could not be re-encrypted (undecryptable ciphertext or a failed
   * UPDATE); logged per row and skipped so the sweep stays resumable. */
  failed: number;
  /** Rows left alone because their credentials were rewritten (a token
   * refresh, a cleared or reconnected Garmin login, a disconnect) between the
   * sweep's read and its UPDATE. The writer encrypted under the active key
   * itself; a re-run picks up anything still on an old version. */
  changedDuringSweep: number;
}

interface TableSweepResult {
  updated: number;
  failed: number;
  changed: number;
}

/**
 * The column still holds exactly the value the sweep read, null included.
 * Every UPDATE is a compare-and-swap on these, so a credential rewritten after
 * the snapshot is never overwritten with the re-encrypted snapshot: an
 * unconditional write could revert a Strava refresh token rotated mid-sweep
 * (forcing a reconnect) or re-store Garmin credentials cleared after an auth
 * failure (D42 (CODEBASE_ANALYSIS_2026-10-03)).
 */
function unchangedSinceRead(column: AnyColumn, read: string | null): SQL {
  return read === null ? isNull(column) : eq(column, read);
}

// Re-encrypt a single nullable column value under the active key. Returns the
// (possibly unchanged) value plus whether it actually moved, so the caller can
// skip a no-op UPDATE.
function remap(value: string | null): { value: string | null; changed: boolean } {
  if (!value) return { value, changed: false };
  const next = reencryptToken(value);
  return { value: next, changed: next !== value };
}

async function reencryptStrava(): Promise<TableSweepResult> {
  const rows = await db
    .select({
      id: stravaConnections.id,
      accessToken: stravaConnections.accessToken,
      refreshToken: stravaConnections.refreshToken,
    })
    .from(stravaConnections);

  let updated = 0;
  let failed = 0;
  let changed = 0;
  // One row at a time, so a boot-time sweep over every stored credential
  // never takes the whole pool.
  await inSequence(rows, async (row) => {
    try {
      const access = remap(row.accessToken);
      const refresh = remap(row.refreshToken);
      if (!access.changed && !refresh.changed) return;
      const written = await db
        .update(stravaConnections)
        .set({
          accessToken: access.value ?? row.accessToken,
          refreshToken: refresh.value ?? row.refreshToken,
        })
        .where(
          and(
            eq(stravaConnections.id, row.id),
            unchangedSinceRead(stravaConnections.accessToken, row.accessToken),
            unchangedSinceRead(stravaConnections.refreshToken, row.refreshToken),
          ),
        )
        .returning({ id: stravaConnections.id });
      if (written.length === 0) {
        changed += 1;
        return;
      }
      updated += 1;
    } catch (error) {
      // Per-row isolation: one versioned-but-undecryptable value must not abort
      // the rest of the sweep (it used to — everything after the poison row,
      // including the whole garmin table, was silently skipped every run).
      failed += 1;
      // only the table name, row
      // id and the operational error are logged; no token material.
      // bearer:disable javascript_lang_logger_leak
      logger.warn(
        { context: "crypto", table: "strava_connections", id: row.id, err: error },
        "Skipping credential row that failed re-encryption",
      );
    }
  });
  return { updated, failed, changed };
}

async function reencryptGarmin(): Promise<TableSweepResult> {
  const rows = await db
    .select({
      id: garminConnections.id,
      encryptedEmail: garminConnections.encryptedEmail,
      encryptedPassword: garminConnections.encryptedPassword,
      encryptedOauth1Token: garminConnections.encryptedOauth1Token,
      encryptedOauth2Token: garminConnections.encryptedOauth2Token,
    })
    .from(garminConnections);

  let updated = 0;
  let failed = 0;
  let changed = 0;
  // One row at a time, as in the Strava sweep above.
  await inSequence(rows, async (row) => {
    try {
      const email = remap(row.encryptedEmail);
      const password = remap(row.encryptedPassword);
      const oauth1 = remap(row.encryptedOauth1Token);
      const oauth2 = remap(row.encryptedOauth2Token);
      if (!email.changed && !password.changed && !oauth1.changed && !oauth2.changed) return;
      const written = await db
        .update(garminConnections)
        .set({
          encryptedEmail: email.value,
          encryptedPassword: password.value,
          encryptedOauth1Token: oauth1.value,
          encryptedOauth2Token: oauth2.value,
        })
        .where(
          and(
            eq(garminConnections.id, row.id),
            unchangedSinceRead(garminConnections.encryptedEmail, row.encryptedEmail),
            unchangedSinceRead(garminConnections.encryptedPassword, row.encryptedPassword),
            unchangedSinceRead(garminConnections.encryptedOauth1Token, row.encryptedOauth1Token),
            unchangedSinceRead(garminConnections.encryptedOauth2Token, row.encryptedOauth2Token),
          ),
        )
        .returning({ id: garminConnections.id });
      if (written.length === 0) {
        changed += 1;
        return;
      }
      updated += 1;
    } catch (error) {
      failed += 1;
      // only the table name, row
      // id and the operational error are logged; no token material.
      // bearer:disable javascript_lang_logger_leak
      logger.warn(
        { context: "crypto", table: "garmin_connections", id: row.id, err: error },
        "Skipping credential row that failed re-encryption",
      );
    }
  });
  return { updated, failed, changed };
}

/**
 * Migrate every stored Strava/Garmin credential forward to the active
 * encryption key version (W6). Idempotent: rows already on the current version
 * are left untouched, so it's safe to re-run. Single-flighted across replicas
 * via an advisory lock.
 *
 * Tokens also migrate lazily — the storage layer re-encrypts on every write, so
 * a refreshing Strava token picks up the new key naturally. This sweep covers
 * the long-lived rows (e.g. Garmin credentials) that may not be rewritten soon.
 * The advisory lock only single-flights the sweep; it does not fence those
 * request-path writers, which is why each row's UPDATE is a compare-and-swap.
 */
export async function reencryptStoredCredentials(): Promise<ReencryptSummary | null> {
  const result = await withPgAdvisoryLock(
    pool,
    { key: KEY_ROTATION_LOCK_KEY, name: "keyRotationReencrypt" },
    async () => {
      const strava = await reencryptStrava();
      const garmin = await reencryptGarmin();
      return {
        stravaUpdated: strava.updated,
        garminUpdated: garmin.updated,
        failed: strava.failed + garmin.failed,
        changedDuringSweep: strava.changed + garmin.changed,
      };
    },
  );

  if (!result.acquired) return null;
  return result.value;
}

/**
 * Startup hook: run the sweep only when a rotation key is configured AND the
 * operator has explicitly opted in via ENCRYPTION_REENCRYPT_ON_BOOT=true.
 * Off by default so a normal deploy never rewrites the credential tables.
 * Never throws — a migration hiccup must not block boot.
 */
export async function maybeReencryptOnBoot(): Promise<void> {
  if (!env.ENCRYPTION_KEY_V2 || env.ENCRYPTION_REENCRYPT_ON_BOOT !== "true") {
    return;
  }
  try {
    const summary = await reencryptStoredCredentials();
    if (summary) {
      // Escalate to warn when rows were skipped so a poisoned credential row
      // is visible in logs instead of hiding inside an info line.
      const log = summary.failed > 0 ? logger.warn.bind(logger) : logger.info.bind(logger);
      // only the key version and row counts
      // (stravaUpdated/garminUpdated/failed/changedDuringSweep) are logged; no token
      // plaintext ever reaches the logger (reencryptToken keeps it in scope).
      // bearer:disable javascript_lang_logger_leak
      log(
        { context: "crypto", version: currentKeyVersion(), ...summary },
        "Re-encrypted stored credentials to current key version",
      );
    }
  } catch (error) {
    // the caught error is a DB /
    // operational failure of the sweep, not credential material.
    // bearer:disable javascript_lang_logger_leak
    logger.error({ context: "crypto", err: error }, "Credential re-encrypt sweep failed");
  }
}

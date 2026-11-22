/**
 * Every fixed Postgres advisory-lock key the server takes with
 * `withPgAdvisoryLock` (server/advisoryLock.ts), in one module so one test can
 * check that no two share a value (server/cron.test.ts). The keys used to live
 * in three files, with a comment standing in for the check on the two outside
 * cron.ts (R4, REFACTORING_REVIEW 2026-09-23).
 *
 * A collision is SILENT: pg_try_advisory_lock makes the second caller skip its
 * protected work entirely. analyticsRecompute and nutritionEmbeddingBackfill
 * once collided with the key-rotation and migration slots, letting a running
 * backfill silently skip boot migrations.
 *
 * NEVER CHANGE A VALUE. During a rolling deploy old and new replicas contend
 * on these numbers; renumbering a lock lets both run its work at once. Rename
 * freely, but keep the number. Next free key: 42_010_022.
 *
 * Per-user locks derive their keys from a hash instead (the Strava token
 * refresh, and the transaction-scoped `hashtextextended` locks), so they are
 * not listed here.
 */

/** One key per cron job (server/cron.ts); the property name is the job's lock name. */
export const CRON_LOCK_KEYS = {
  // Renamed from `dailyEmail` when the tick went hourly; the numeric key is
  // unchanged so old and new replicas contend on the same lock mid-deploy.
  emailScheduler: 42_010_001n,
  idempotencyCleanup: 42_010_002n,
  aiUsageCleanup: 42_010_003n,
  staleAutoCoaching: 42_010_004n,
  queueDepthTelemetry: 42_010_005n,
  structuredExerciseRollup: 42_010_006n,
  startupEmailCatchUp: 42_010_007n,
  sharedRuntimeCleanup: 42_010_008n,
  analyticsRecompute: 42_010_011n,
  nutritionEmbeddingBackfill: 42_010_012n,
  nutritionReminders: 42_010_013n,
  ragChunkPrune: 42_010_014n,
  accountErasureSweep: 42_010_015n,
  stravaAutoSync: 42_010_016n,
  stravaWebhookEnsure: 42_010_017n,
  recycleBinPurge: 42_010_018n,
  sessionStreamBackfill: 42_010_019n,
  planDayMovePrune: 42_010_020n,
  stalePlanGenerations: 42_010_021n,
} as const;

/** The boot-time credential re-encrypt sweep (server/services/keyRotation.ts). */
export const KEY_ROTATION_LOCK_KEY = 42_010_009n;

/** Drizzle migrations at boot (server/maintenance.ts). */
export const MIGRATION_ADVISORY_LOCK_KEY = 42_010_010n;

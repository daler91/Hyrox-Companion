import type { Pool } from "pg";

/**
 * Tables whose absence after boot-time migration means the schema is unusable
 * and the instance must not serve traffic. Kept small and stable: these have
 * existed since the earliest migrations and back every core surface.
 */
export const CRITICAL_TABLES = [
  "users",
  "workout_logs",
  "plan_days",
  "foods",
  "analytics_results",
] as const;

/**
 * Errors expected when in-process migrate() runs against a schema that
 * drizzle-kit push already manages (the CI/production source of truth):
 * the first CREATE/ALTER hits an "already exists" and the batch aborts,
 * which is a healthy no-op boot, not a failure.
 */
export function isBenignIdempotencyError(error: unknown): boolean {
  const errStr = String((error as { message?: string })?.message ?? error).toLowerCase();
  return (
    errStr.includes("already exists") ||
    errStr.includes("duplicate key") ||
    errStr.includes("duplicate object")
  );
}

/**
 * Throw if any critical table is missing. A boot that swallows a migration
 * failure and then reports healthy against an empty or partial schema is the
 * worst failure mode we have (every request 500s while the platform keeps
 * routing traffic), so this check gates readiness: the thrown error reaches
 * the startup catch in server/index.ts, which sets startupState.startupError
 * and flips both health endpoints to 503.
 */
export async function assertCriticalTablesExist(pool: Pick<Pool, "query">): Promise<void> {
  const { rows } = await pool.query<{ missing: string }>(
    `SELECT t AS missing FROM unnest($1::text[]) AS t WHERE to_regclass('public.' || t) IS NULL`,
    [[...CRITICAL_TABLES]],
  );
  if (rows.length > 0) {
    throw new Error(
      `Critical tables missing after migration: ${rows.map((r) => r.missing).join(", ")} — refusing to serve an incomplete schema`,
    );
  }
}

/**
 * Postgres error-code helpers shared by the storage layer and services.
 *
 * Drizzle wraps the driver error (the `code` lives on `err.cause`, and node-pg
 * can nest once more), so a bare `err.code === "23505"` misses most real
 * violations. Walk the cause chain, bounded so a cyclic cause can't spin.
 */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; current && typeof current === "object" && depth < 5; depth++) {
    const rec = current as { code?: unknown; cause?: unknown };
    if (rec.code === "23505") return true;
    current = rec.cause;
  }
  return false;
}

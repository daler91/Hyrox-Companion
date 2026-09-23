/**
 * Postgres error-code helpers shared by the storage layer and services.
 *
 * Drizzle wraps the driver error (the `code` lives on `err.cause`, and node-pg
 * can nest once more), so a bare `err.code === "23505"` misses most real
 * violations. Walk the cause chain, bounded so a cyclic cause can't spin.
 *
 * Pass `constraint` to match one named unique index/constraint only; both the
 * code and the name are read from the same link of the chain.
 */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  let current: unknown = err;
  for (let depth = 0; current && typeof current === "object" && depth < 5; depth++) {
    const rec = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (rec.code === "23505" && (constraint === undefined || rec.constraint === constraint)) {
      return true;
    }
    current = rec.cause;
  }
  return false;
}

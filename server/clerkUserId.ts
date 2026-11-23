import { getAuth } from "@clerk/express";
import type { Request } from "express";

/**
 * The Clerk user id on a request, or undefined when there is none.
 *
 * `getAuth()` throws when `clerkMiddleware()` has not run: the dev auth-bypass
 * path boots without Clerk keys, and pino-http's first `customProps` call runs
 * before the middleware is mounted. Every caller here treats that as "no user",
 * so the try/catch lives in one place instead of four (C-getAuth,
 * REFACTORING_REVIEW 2026-09-23). `bearerAuthState` (middleware/csrf.ts) keeps
 * its own: it must tell "Clerk did not run" apart from "Clerk rejected the
 * token".
 *
 * Kept free of other server imports so the logger, the CSRF middleware and the
 * rate limiter can use it without pulling in storage or the database.
 */
export function getClerkUserId(req: Request): string | undefined {
  try {
    return getAuth(req)?.userId ?? undefined;
  } catch {
    return undefined;
  }
}

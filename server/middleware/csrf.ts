import { randomBytes } from "node:crypto";

import { getAuth } from "@clerk/express";
import { doubleCsrf } from "csrf-csrf";
import type { Request, RequestHandler } from "express";

import { env } from "../env";
import { logger } from "../logger";

/**
 * CSRF protection using the double-submit cookie pattern (csrf-csrf).
 *
 * Rationale (CODEBASE_AUDIT.md §2): the app uses credentialed cookie auth
 * (Clerk) with CORS allowing credentials from whitelisted origins. CORS is
 * not a CSRF control, so every state-changing /api/v1 route must verify a
 * token that an attacker cannot read from a cross-site context.
 *
 * Flow:
 *   1. Client calls GET /api/v1/csrf-token once (safe method, exempt from
 *      verification); server sets a signed csrf cookie and returns the
 *      paired token in JSON.
 *   2. Client attaches the token as the `x-csrf-token` header on any
 *      mutating request (POST/PUT/PATCH/DELETE). The middleware verifies
 *      the header matches the cookie HMAC before forwarding.
 *
 * Session identifier: bound to the Clerk userId when authenticated, so
 * tokens issued pre-login are invalidated after sign-in and tokens cannot
 * be replayed across users. Falls back to the client IP for the brief
 * pre-login window (login flow itself does not hit mutating endpoints).
 */

// CSRF_SECRET is required in production (see env.ts refine). When it's
// unset in dev, generate a random per-process secret instead of aliasing
// ENCRYPTION_KEY (Suggestion-2): the two secrets are required to be
// distinct in prod, and the dev alias made the non-prod behaviour diverge
// from the prod invariant. A per-process random still works because the
// CSRF cookie never needs to outlive the server process.
function resolveCsrfSecret(): string {
  if (env.CSRF_SECRET) return env.CSRF_SECRET;
  const generated = randomBytes(32).toString("hex");
  logger.warn(
    { context: "csrf" },
    "CSRF_SECRET not set — generated a per-process random dev secret. Set CSRF_SECRET before deploying to production.",
  );
  return generated;
}
const csrfSecret = resolveCsrfSecret();

const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
  getSecret: () => csrfSecret,
  getSessionIdentifier: (req: Request) => {
    try {
      const auth = getAuth(req);
      if (auth?.userId) return auth.userId;
    } catch {
      // getAuth throws if clerk middleware hasn't run — fall through
    }
    return req.ip ?? "anonymous";
  },
  cookieName: env.NODE_ENV === "production" ? "__Host-fitai.x-csrf" : "fitai.x-csrf",
  cookieOptions: {
    httpOnly: true,
    sameSite: "strict",
    secure: env.NODE_ENV === "production",
    path: "/",
  },
  // Method list intentionally excludes GET/HEAD/OPTIONS (safe methods)
  // so clients can fetch the token endpoint without first having a token.
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
  getCsrfTokenFromRequest: (req: Request) => req.headers["x-csrf-token"],
});

export const csrfProtection: RequestHandler = doubleCsrfProtection;

/** Issues a fresh CSRF token + paired cookie. Mount as GET /api/v1/csrf-token. */
export const csrfTokenHandler: RequestHandler = (req, res) => {
  const token = generateCsrfToken(req, res);
  res.json({ csrfToken: token });
};

import type { Request, RequestHandler } from "express";
import { doubleCsrf } from "csrf-csrf";
import { getAuth } from "@clerk/express";
import { env } from "../env";

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

// Reuse ENCRYPTION_KEY as a fallback to avoid adding a new required env var.
// Operators may set CSRF_SECRET explicitly to rotate it independently.
const csrfSecret = env.CSRF_SECRET ?? env.ENCRYPTION_KEY;

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
  cookieName: env.NODE_ENV === "production" ? "__Host-hyrox.x-csrf" : "hyrox.x-csrf",
  cookieOptions: {
    httpOnly: true,
    sameSite: "strict",
    secure: env.NODE_ENV === "production",
    path: "/",
  },
  // Method list intentionally excludes GET/HEAD/OPTIONS (safe methods)
  // so clients can fetch the token endpoint without first having a token.
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
  getCsrfTokenFromRequest: (req: Request) => req.headers["x-csrf-token"] as string | undefined,
});

export const csrfProtection: RequestHandler = doubleCsrfProtection;

/** Issues a fresh CSRF token + paired cookie. Mount as GET /api/v1/csrf-token. */
export const csrfTokenHandler: RequestHandler = (req, res) => {
  const token = generateCsrfToken(req, res);
  res.json({ csrfToken: token });
};

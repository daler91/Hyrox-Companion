import { randomBytes } from "node:crypto";

import { getAuth } from "@clerk/express";
import { type CsrfRequestMethod, doubleCsrf } from "csrf-csrf";
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
 * Requests Clerk authenticated from an `Authorization: Bearer` header (the
 * native mobile app) carry no ambient credential and skip the check; see
 * bearerAuthState below for the exact conditions.
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
  // Static config warning; the generated secret itself is never logged.
  // bearer:disable javascript_lang_logger_leak
  logger.warn(
    { context: "csrf" },
    "CSRF_SECRET not set — generated a per-process random dev secret. Set CSRF_SECRET before deploying to production.",
  );
  return generated;
}
const csrfSecret = resolveCsrfSecret();

/** Safe methods: never verified, so a client can fetch the token endpoint without a token. */
const CSRF_IGNORED_METHOD_LIST: CsrfRequestMethod[] = ["GET", "HEAD", "OPTIONS"];
const CSRF_IGNORED_METHODS: ReadonlySet<string> = new Set(CSRF_IGNORED_METHOD_LIST);

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
  ignoredMethods: CSRF_IGNORED_METHOD_LIST,
  getCsrfTokenFromRequest: (req: Request) => req.headers["x-csrf-token"],
});

/**
 * Bearer-token requests (the native mobile app) and the CSRF check.
 *
 * CSRF exists because a browser attaches cookies to a cross-site request on
 * its own. A bearer token is never attached automatically: the client has to
 * put it in the `Authorization` header itself, and a cross-site page cannot
 * add that header without a CORS preflight, which the origin allowlist in
 * server/index.ts refuses. So a request that Clerk authenticated from the
 * header cannot have been forged by another site, and it carries no cookie
 * the double-submit check could pair with anyway. Clerk reads a token in the
 * header ahead of any session cookie (authenticateRequestWithTokenInHeader in
 * @clerk/backend), so the header is what authenticated it.
 *
 * Kept narrow on purpose:
 *   - A request that also carries a Clerk session cookie keeps the check, so
 *     the cookie-authenticated web app is exactly as protected as before.
 *   - When Clerk middleware is not installed (the dev auth bypass without
 *     keys), nothing is exempt: the bypass resolves a user without any token,
 *     so a bearer header there proves nothing.
 *   - A bearer token Clerk rejects (expired, revoked, another instance) gets
 *     the 401 `isAuthenticated` would have given, rather than a CSRF error that
 *     would send the app looking for a cookie it never has. Every mutating
 *     route behind this guard requires authentication, so no request that
 *     could have succeeded is turned away.
 */
const BEARER_AUTHORIZATION = /^Bearer\s+\S+$/i;
/** Clerk's session cookie: `__session`, or `__session_<suffix>` on multi-instance setups. */
const CLERK_SESSION_COOKIE = /^__session(?:_[\w-]+)?$/;

function hasClerkSessionCookie(req: Request): boolean {
  const header = req.headers.cookie;
  if (!header) return false;
  return header.split(";").some((part) => CLERK_SESSION_COOKIE.test(part.split("=", 1)[0].trim()));
}

/**
 * How a request stands with respect to bearer-token auth:
 * - `none`: no bearer header, a session cookie alongside it, or no Clerk
 *   middleware to verify it. The normal double-submit check applies.
 * - `authenticated`: Clerk verified the header token. CSRF does not apply.
 * - `rejected`: a bearer-only request whose token Clerk did not accept.
 */
export function bearerAuthState(req: Request): "none" | "authenticated" | "rejected" {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !BEARER_AUTHORIZATION.test(authorization)) return "none";
  if (hasClerkSessionCookie(req)) return "none";
  let userId: string | null | undefined;
  try {
    userId = getAuth(req)?.userId;
  } catch {
    // getAuth throws when clerkMiddleware has not run (no Clerk keys).
    return "none";
  }
  return userId ? "authenticated" : "rejected";
}

export const csrfProtection: RequestHandler = (req, res, next) => {
  if (!CSRF_IGNORED_METHODS.has(req.method)) {
    const state = bearerAuthState(req);
    if (state === "authenticated") {
      next();
      return;
    }
    if (state === "rejected") {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }
  }
  doubleCsrfProtection(req, res, next);
};

/** Issues a fresh CSRF token + paired cookie. Mount as GET /api/v1/csrf-token. */
export const csrfTokenHandler: RequestHandler = (req, res) => {
  const token = generateCsrfToken(req, res);
  res.json({ csrfToken: token });
};

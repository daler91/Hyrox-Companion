import type { NextFunction, Request, Response } from "express";

// Single source of truth for the Content-Security-Policy header.
//
// Previously the policy was declared twice: once in the `helmet()` config and
// once in a hand-built override middleware that silently replaced helmet's
// header on every request. The helmet copy was dead code (always overwritten)
// and its `connectSrc: ["'self'"]` was actively misleading — removing the
// override would have collapsed connect-src to 'self' and broken Clerk/Strava/
// Sentry with no test catching it. Helmet's CSP is now disabled and this module
// is the only place the directives live.

const CLERK_DOMAINS = "https://*.clerk.accounts.dev https://*.fitai.coach https://clerk.fitai.coach";

/**
 * Build the Content-Security-Policy header value.
 *
 * Dev relaxes script-src to 'unsafe-inline'/'unsafe-eval' (Vite HMR) and adds
 * ws:/wss: to connect-src for the HMR socket. Production uses a per-request
 * nonce for script-src and omits the websocket sources.
 */
export function buildCspPolicy(opts: { isDev: boolean; nonce?: string }): string {
  const { isDev, nonce } = opts;

  const scriptSrc = isDev
    ? `'self' 'unsafe-inline' 'unsafe-eval' ${CLERK_DOMAINS}`
    : `'self' 'nonce-${nonce ?? ""}' ${CLERK_DOMAINS}`;

  const connectSrc = [
    "'self'",
    CLERK_DOMAINS,
    "https://www.strava.com",
    "https://*.ingest.us.sentry.io",
    ...(isDev ? ["ws:", "wss:"] : []),
  ].join(" ");

  return [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${CLERK_DOMAINS}`,
    `font-src 'self' https://fonts.gstatic.com data:`,
    `img-src 'self' data: https://img.clerk.com https://*.clerk.com https://*.strava.com`,
    `connect-src ${connectSrc}`,
    `frame-src 'self' ${CLERK_DOMAINS}`,
    `frame-ancestors 'none'`,
    `worker-src 'self' blob:`,
  ].join("; ");
}

/**
 * Express middleware that sets the CSP header from {@link buildCspPolicy}.
 * In production it reads the per-request nonce seeded by `cspNonceMiddleware`,
 * which must run before this middleware.
 */
export function cspHeaderMiddleware(isDev: boolean) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("Content-Security-Policy", buildCspPolicy({ isDev, nonce: res.locals.cspNonce }));
    next();
  };
}

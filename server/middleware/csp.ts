import type { IncomingMessage, ServerResponse } from "node:http";

import type { Response } from "express";
import type { HelmetOptions } from "helmet";

// Single source of truth for the Content-Security-Policy directives.
//
// These directives are handed to helmet() so the CSP header is owned by one
// well-tested layer — no hand-built override middleware that silently replaces
// helmet's header (the M1 footgun), and no `contentSecurityPolicy: false`
// (which static analysers read as "CSP disabled"). In production, script-src
// carries a per-request nonce seeded by cspNonceMiddleware (which must run
// before helmet); dev relaxes to 'unsafe-inline'/'unsafe-eval' for Vite HMR and
// adds the ws:/wss: HMR socket origins to connect-src.

const CLERK_DOMAINS = ["https://*.clerk.accounts.dev", "https://*.fitai.coach", "https://clerk.fitai.coach"];

type CspDirectives = NonNullable<
  Exclude<HelmetOptions["contentSecurityPolicy"], boolean | undefined>["directives"]
>;

export function buildCspDirectives({ isDev }: { isDev: boolean }): CspDirectives {
  const scriptSrc = isDev
    ? ["'self'", "'unsafe-inline'", "'unsafe-eval'", ...CLERK_DOMAINS]
    : [
        "'self'",
        (_req: IncomingMessage, res: ServerResponse) => `'nonce-${(res as Response).locals.cspNonce}'`,
        ...CLERK_DOMAINS,
      ];

  return {
    defaultSrc: ["'self'"],
    scriptSrc,
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", ...CLERK_DOMAINS],
    fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
    imgSrc: ["'self'", "data:", "https://img.clerk.com", "https://*.clerk.com", "https://*.strava.com"],
    connectSrc: [
      "'self'",
      ...CLERK_DOMAINS,
      "https://www.strava.com",
      "https://*.ingest.us.sentry.io",
      ...(isDev ? ["ws:", "wss:"] : []),
    ],
    frameSrc: ["'self'", ...CLERK_DOMAINS],
    frameAncestors: ["'none'"],
    workerSrc: ["'self'", "blob:"],
  };
}

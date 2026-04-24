// Import `pino-http` for its type-augmentation on Request.log; the value
// import keeps the augmentation visible to TypeScript even though we don't
// use any exported runtime bindings from the module here.
import "pino-http";

import type { Request } from "express";
import pino from "pino";

import { env } from "./env";
import { getRequestContext } from "./requestContext";

const isDev = env.NODE_ENV !== "production";

export const logger = pino({
  level: env.LOG_LEVEL || "info",
  // Redact credentials that can appear in either headers or request bodies.
  // Body fields are common in OAuth/integration callbacks and account flows;
  // leaving them unredacted leaks tokens into log aggregators and Sentry
  // breadcrumbs. `*` covers nested objects (e.g. req.body.strava.accessToken).
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "req.headers.x-cron-secret",
    'req.body.password',
    'req.body.newPassword',
    'req.body.currentPassword',
    'req.body.accessToken',
    'req.body.refreshToken',
    'req.body.token',
    'req.body.apiKey',
    'req.body.clientSecret',
    'req.body.*.password',
    'req.body.*.accessToken',
    'req.body.*.refreshToken',
  ],
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      }
    : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
});

export function getContextLogger() {
  const ctx = getRequestContext();
  if (ctx) {
    return logger.child({ requestId: ctx.requestId, userId: ctx.userId });
  }
  return logger;
}

/**
 * Prefer the per-request child logger attached by pino-http (request id +
 * user id are already bound). Fall back to the module-level logger when the
 * request hasn't been through the pino-http middleware yet (e.g. lower-level
 * middleware, or error handlers reached before req.log was set).
 *
 * Extracted so the 24+ `req.log || logger` call sites stay consistent and
 * can pick up future enhancements — e.g. always preferring the async-local
 * request context child — in one place.
 */
export function reqLogger(req: Request) {
  return req.log ?? logger;
}

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

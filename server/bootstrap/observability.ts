import * as Sentry from "@sentry/node";

import { env } from "../env";
import { logger } from "../logger";

let observabilityInitialized = false;

export function initObservability(): void {
  if (observabilityInitialized) return;
  observabilityInitialized = true;

  if (!env.SENTRY_DSN) {
    logger.info({ context: "sentry" }, "SENTRY_DSN not set — error reports disabled");
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV || "development",
    sendDefaultPii: false,
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1,
    // 🛡️ Sentinel: Strip PII-bearing fields from error payloads before
    // transmission (CODEBASE_REVIEW_2026-04-12.md #2). Even with
    // sendDefaultPii=false, manually captured errors can carry request
    // bodies, query strings, cookies, or auth headers that contain user
    // email/name/biometrics.
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.query_string;
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
          delete event.request.headers["x-csrf-token"];
          delete event.request.headers["x-idempotency-key"];
        }
      }
      if (event.user) {
        delete event.user.email;
        delete event.user.username;
        delete event.user.ip_address;
      }
      return event;
    },
  });

  const client = Sentry.getClient();
  const dsn = env.SENTRY_DSN;
  const schemeEnd = dsn.indexOf("//");
  const atIdx = schemeEnd >= 0 ? dsn.indexOf("@", schemeEnd + 2) : -1;
  const maskedDsn = atIdx > schemeEnd + 2
    ? `${dsn.slice(0, schemeEnd + 2)}***${dsn.slice(atIdx)}`
    : dsn;

  if (client) {
    logger.info({ context: "sentry", environment: env.NODE_ENV || "development", dsn: maskedDsn }, "Sentry error reporting initialised");
  } else {
    logger.warn({ context: "sentry", dsn: maskedDsn }, "Sentry.init returned without a client — error reports will be dropped");
  }
}

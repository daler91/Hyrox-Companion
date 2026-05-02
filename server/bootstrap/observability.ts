import * as Sentry from "@sentry/node";

import { env } from "../env";
import { logger } from "../logger";

export function initObservability(): void {
  if (!env.SENTRY_DSN) {
    logger.info({ context: "sentry" }, "SENTRY_DSN not set — error reports disabled");
    return;
  }
  Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV || "development", sendDefaultPii: false, tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1 });
}

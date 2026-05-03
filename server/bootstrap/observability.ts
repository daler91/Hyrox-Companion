import * as Sentry from "@sentry/node";

import { env } from "../env";
import { logger } from "../logger";

export function configureObservability(deps: { init?: typeof Sentry.init; getClient?: typeof Sentry.getClient } = {}): void {
  const init = deps.init ?? Sentry.init;
  const getClient = deps.getClient ?? Sentry.getClient;

  if (!env.SENTRY_DSN) {
    logger.info({ context: "sentry" }, "SENTRY_DSN not set — error reports disabled");
    return;
  }

  init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV || "development",
    sendDefaultPii: false,
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1,
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

  const client = getClient();
  logger.info({ context: "sentry", clientReady: Boolean(client) }, "Sentry error reporting initialised");
}

export function registerProcessErrorHandlers(deps: { onUncaught: (cb: (err: Error) => void) => void; onUnhandled: (cb: (reason: unknown) => void) => void; setStartupError: (message: string) => void; captureException?: (err: unknown) => void; }): void {
  const captureException = deps.captureException ?? Sentry.captureException;
  deps.onUncaught((err) => {
    logger.fatal({ err }, "Uncaught exception in server process");
    deps.setStartupError(`uncaught_exception: ${err.message}`);
    captureException(err);
  });
  deps.onUnhandled((reason) => {
    logger.fatal({ err: reason }, "Unhandled rejection in server process");
    deps.setStartupError(`unhandled_rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
    captureException(reason);
  });
}

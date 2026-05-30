import * as Sentry from "@sentry/node";

import { env } from "../env";
import { logger, SENSITIVE_REQUEST_HEADERS } from "../logger";

function resolveSentryRelease(): string | undefined {
  // The Sentry esbuild plugin injects a release identifier into the bundle at
  // build time when SENTRY_AUTH_TOKEN is configured. If absent (local dev,
  // contributor builds), fall back to the package version so events still
  // group sensibly by deployment.
  if (process.env.SENTRY_RELEASE) return process.env.SENTRY_RELEASE;
  const version = process.env.npm_package_version;
  return version ? `fitai-coach@${version}` : undefined;
}

// Breadcrumb data keys that can carry full HTTP payloads — Sentry's http,
// fetch, and xhr integrations all attach the originating request/response
// body to the breadcrumb under one of these names. We drop them blindly so a
// thrown error doesn't bring a workout/chat payload along for the ride.
const BREADCRUMB_PAYLOAD_KEYS = ["body", "payload", "request_body", "response_body"] as const;

function stripUrlQuery(url: unknown): unknown {
  if (typeof url !== "string") return url;
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return url;
  return `${url.slice(0, queryStart)}?[redacted]`;
}

/**
 * Pure scrubber used by Sentry's `beforeSend` hook. Removes PII and
 * request/response bodies from every part of the event the SDK assembles —
 * `request`, `user`, `breadcrumbs`, and the `request`/`response` keys on
 * `contexts`. Exported so the regression suite in observability.test.ts can
 * exercise it without booting the SDK.
 */
export function scrubSentryEvent<T extends Sentry.Event>(event: T): T {
  if (event.request) {
    delete event.request.data;
    delete event.request.query_string;
    delete event.request.cookies;
    const headers = event.request.headers;
    if (headers) {
      // Scrub the same sensitive headers the pino logger redacts.
      for (const header of SENSITIVE_REQUEST_HEADERS) {
        Reflect.deleteProperty(headers, header);
      }
    }
  }
  if (event.user) {
    delete event.user.email;
    delete event.user.username;
    delete event.user.ip_address;
  }
  // Breadcrumbs are the primary leak channel post-C3: Sentry's http/fetch/xhr
  // integrations attach request and response bodies, and URL query strings can
  // carry user identifiers or tokens.
  if (event.breadcrumbs) {
    for (const crumb of event.breadcrumbs) {
      if (!crumb || typeof crumb !== "object" || !crumb.data) continue;
      const data = crumb.data as Record<string, unknown>;
      for (const key of BREADCRUMB_PAYLOAD_KEYS) {
        if (key in data) delete data[key];
      }
      if ("url" in data) data.url = stripUrlQuery(data.url);
    }
  }
  // Contexts are the secondary leak channel — Sentry's express integration
  // mirrors request/response objects here when `sendDefaultPii` is on, and
  // misconfigured user code can set anything. Drop the well-known body-bearing
  // keys; leave the rest (runtime, os, device, etc.) so we keep the diagnostic
  // value.
  if (event.contexts) {
    delete event.contexts.request;
    delete event.contexts.response;
  }
  return event;
}

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
    release: resolveSentryRelease(),
    sendDefaultPii: false,
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1,
    beforeSend: scrubSentryEvent,
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

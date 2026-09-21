import type * as Sentry from "@sentry/react";

/**
 * Client-side Sentry scrubber, the browser counterpart to
 * `scrubSentryEvent` in server/bootstrap/observability.ts.
 *
 * `sendDefaultPii: false` alone was not enough. Three channels were carrying
 * athlete data off-device even for consented users:
 *
 *  1. `apiRequest` throws `new Error(\`${status}: ${body}\`)` (queryClient.ts),
 *     so the raw 4xx response body — Zod validation errors echo the submitted
 *     field values, and integration errors echo provider text — became the
 *     exception message.
 *  2. Navigation breadcrumbs record `pathname?search`
 *     (useNavigationBreadcrumb.ts), e.g. `/nutrition?date=…&meal=…`, and the
 *     SDK's own fetch/xhr breadcrumbs record request URLs with query strings.
 *  3. The SDK's fetch/xhr integrations attach request and response bodies to
 *     breadcrumb `data`.
 *
 * Everything here is pure so the regression suite can exercise it without
 * booting the SDK.
 */

/**
 * Breadcrumb data keys that can carry a full HTTP payload. Mirrors
 * BREADCRUMB_PAYLOAD_KEYS on the server.
 */
const BREADCRUMB_PAYLOAD_KEYS = ["body", "payload", "request_body", "response_body"] as const;

/** Breadcrumb data keys that hold a URL and therefore a query string. */
const BREADCRUMB_URL_KEYS = ["url", "from", "to"] as const;

/**
 * `<status>: <body>` as thrown by apiRequest. The body is replaced wholesale
 * rather than truncated — a prefix of a validation error still quotes the
 * athlete's input.
 */
const API_ERROR_MESSAGE = /^(\d{3}): [\s\S]+$/;

export function stripUrlQuery(url: unknown): unknown {
  if (typeof url !== "string") return url;
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return url;
  return `${url.slice(0, queryStart)}?[redacted]`;
}

/**
 * Replace the response-body half of an `apiRequest` error message with a
 * placeholder, keeping the status code (the part that is actually diagnostic).
 * Non-matching messages are returned untouched.
 */
export function redactApiErrorMessage(message: unknown): unknown {
  if (typeof message !== "string") return message;
  const match = API_ERROR_MESSAGE.exec(message);
  if (!match) return message;
  return `${match[1]}: [redacted]`;
}

function scrubBreadcrumbData(data: Record<string, unknown>): void {
  for (const key of BREADCRUMB_PAYLOAD_KEYS) {
    if (key in data) delete data[key];
  }
  for (const key of BREADCRUMB_URL_KEYS) {
    if (key in data) data[key] = stripUrlQuery(data[key]);
  }
}

function scrubBreadcrumb(crumb: Sentry.Breadcrumb): void {
  // A navigation crumb's message is the URL itself.
  if (typeof crumb.message === "string") {
    crumb.message = stripUrlQuery(crumb.message) as string;
  }
  if (crumb.data) scrubBreadcrumbData(crumb.data);
}

function scrubBreadcrumbs(breadcrumbs: NonNullable<Sentry.ErrorEvent["breadcrumbs"]>): void {
  for (const crumb of breadcrumbs) {
    if (crumb && typeof crumb === "object") scrubBreadcrumb(crumb);
  }
}

function scrubExceptionValues(event: Sentry.ErrorEvent): void {
  const values = event.exception?.values;
  if (!values) return;
  for (const value of values) {
    if (value && typeof value.value === "string") {
      value.value = redactApiErrorMessage(value.value) as string;
    }
  }
}

/**
 * Pure scrubber for Sentry's `beforeSend`. Strips response bodies from error
 * messages, query strings from URLs wherever they appear, and PII from the
 * request/user blocks.
 */
export function scrubClientSentryEvent<T extends Sentry.ErrorEvent>(event: T): T {
  scrubExceptionValues(event);

  if (typeof event.message === "string") {
    event.message = redactApiErrorMessage(event.message) as string;
  }

  if (event.request) {
    delete event.request.data;
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.headers;
    event.request.url = stripUrlQuery(event.request.url) as string | undefined;
  }

  if (event.user) {
    delete event.user.email;
    delete event.user.username;
    delete event.user.ip_address;
  }

  if (event.breadcrumbs) scrubBreadcrumbs(event.breadcrumbs);

  return event;
}

/**
 * Pure scrubber for Sentry's `beforeBreadcrumb`, which runs as each crumb is
 * recorded. Doing it here as well as in `beforeSend` means a payload never sits
 * in the in-memory breadcrumb buffer waiting for an error that may never come.
 */
export function scrubClientBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
  scrubBreadcrumbs([breadcrumb]);
  return breadcrumb;
}

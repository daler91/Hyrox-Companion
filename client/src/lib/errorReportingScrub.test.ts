import type * as Sentry from "@sentry/react";
import { describe, expect, it } from "vitest";

import {
  redactApiErrorMessage,
  scrubClientBreadcrumb,
  scrubClientSentryEvent,
  stripUrlQuery,
} from "./errorReportingScrub";

function event(partial: Partial<Sentry.ErrorEvent>): Sentry.ErrorEvent {
  return { type: undefined, ...partial };
}

describe("stripUrlQuery", () => {
  it("removes the query string but keeps the path", () => {
    expect(stripUrlQuery("/nutrition?date=2026-09-19&meal=lunch")).toBe("/nutrition?[redacted]");
  });

  it("leaves a query-less URL and non-strings alone", () => {
    expect(stripUrlQuery("/analytics")).toBe("/analytics");
    expect(stripUrlQuery(undefined)).toBeUndefined();
    expect(stripUrlQuery(42)).toBe(42);
  });
});

describe("redactApiErrorMessage", () => {
  it("replaces the response body of an apiRequest error, keeping the status", () => {
    expect(
      redactApiErrorMessage('400: {"code":"VALIDATION_ERROR","details":{"bodyWeightKg":"81.4"}}'),
    ).toBe("400: [redacted]");
  });

  it("redacts a multi-line body", () => {
    expect(redactApiErrorMessage("500: line one\nline two")).toBe("500: [redacted]");
  });

  it("leaves unrelated messages untouched", () => {
    expect(redactApiErrorMessage("Cannot read properties of undefined")).toBe(
      "Cannot read properties of undefined",
    );
    expect(redactApiErrorMessage("404: ")).toBe("404: ");
  });
});

describe("scrubClientSentryEvent", () => {
  it("redacts the response body from exception values", () => {
    const scrubbed = scrubClientSentryEvent(
      event({
        exception: {
          values: [{ type: "Error", value: '422: {"email":"athlete@example.com"}' }],
        },
      }),
    );

    expect(scrubbed.exception?.values?.[0].value).toBe("422: [redacted]");
  });

  it("strips query strings and payloads from breadcrumbs", () => {
    const scrubbed = scrubClientSentryEvent(
      event({
        breadcrumbs: [
          {
            category: "navigation",
            message: "/nutrition?date=2026-09-19&meal=lunch",
            data: { from: "/?workout=abc-123", to: "/nutrition?date=2026-09-19" },
          },
          {
            category: "fetch",
            data: {
              url: "/api/v1/workouts?limit=50&userId=u_1",
              body: '{"notes":"felt awful today"}',
              response_body: '{"id":"w-1"}',
              status_code: 200,
            },
          },
        ],
      }),
    );

    const [nav, fetchCrumb] = scrubbed.breadcrumbs ?? [];
    expect(nav.message).toBe("/nutrition?[redacted]");
    expect(nav.data).toEqual({ from: "/?[redacted]", to: "/nutrition?[redacted]" });
    expect(fetchCrumb.data).toEqual({ url: "/api/v1/workouts?[redacted]", status_code: 200 });
  });

  it("strips PII from the request and user blocks", () => {
    const scrubbed = scrubClientSentryEvent(
      event({
        request: {
          url: "/settings?tab=account",
          query_string: "tab=account",
          cookies: { session: "abc" },
          headers: { authorization: "Bearer x" },
          data: { password: "hunter2" },
        },
        user: { id: "u_1", email: "athlete@example.com", username: "athlete", ip_address: "1.2.3.4" },
      }),
    );

    expect(scrubbed.request).toEqual({ url: "/settings?[redacted]" });
    expect(scrubbed.user).toEqual({ id: "u_1" });
  });

  it("is a no-op on an event with nothing sensitive", () => {
    const scrubbed = scrubClientSentryEvent(event({ message: "boot failed" }));
    expect(scrubbed.message).toBe("boot failed");
  });
});

describe("scrubClientBreadcrumb", () => {
  it("scrubs a crumb as it is recorded, before any error occurs", () => {
    const scrubbed = scrubClientBreadcrumb({
      category: "xhr",
      data: { url: "/api/v1/nutrition/logs?date=2026-09-19", body: '{"grams":120}' },
    });

    expect(scrubbed.data).toEqual({ url: "/api/v1/nutrition/logs?[redacted]" });
  });
});

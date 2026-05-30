import type { Event as SentryEvent } from "@sentry/node";
import { describe, expect, it } from "vitest";

import { scrubSentryEvent } from "./observability";

describe("scrubSentryEvent", () => {
  it("strips request body, query string, and cookies", () => {
    const event: SentryEvent = {
      request: {
        data: { workoutNote: "ran 10 km hard" },
        query_string: "token=abc123",
        cookies: "session=xyz",
        headers: { "user-agent": "test" },
      },
    };

    const result = scrubSentryEvent(event);

    expect(result.request?.data).toBeUndefined();
    expect(result.request?.query_string).toBeUndefined();
    expect(result.request?.cookies).toBeUndefined();
    expect(result.request?.headers).toEqual({ "user-agent": "test" });
  });

  it("strips sensitive request headers but leaves benign ones", () => {
    const event: SentryEvent = {
      request: {
        headers: {
          "user-agent": "test",
          authorization: "Bearer secret",
          cookie: "session=xyz",
          "x-csrf-token": "csrf",
          "x-idempotency-key": "idem",
          "x-cron-secret": "cron",
          "x-internal-analytics-secret": "internal",
        },
      },
    };

    const result = scrubSentryEvent(event);

    expect(result.request?.headers).toEqual({ "user-agent": "test" });
  });

  it("strips email, username, and ip from user context", () => {
    const event: SentryEvent = {
      user: {
        id: "user-123",
        email: "athlete@example.com",
        username: "athlete",
        ip_address: "203.0.113.42",
      },
    };

    const result = scrubSentryEvent(event);

    expect(result.user).toEqual({ id: "user-123" });
  });

  describe("breadcrumbs (C3)", () => {
    it("drops body / payload / request_body / response_body from breadcrumb data", () => {
      const event: SentryEvent = {
        breadcrumbs: [
          {
            category: "fetch",
            data: {
              url: "https://api.example.com/chat",
              method: "POST",
              status_code: 200,
              body: '{"prompt":"my workout"}',
              payload: { secret: 1 },
              request_body: "raw body",
              response_body: "raw response",
            },
          },
        ],
      };

      const result = scrubSentryEvent(event);
      const data = result.breadcrumbs?.[0]?.data ?? {};

      expect("body" in data).toBe(false);
      expect("payload" in data).toBe(false);
      expect("request_body" in data).toBe(false);
      expect("response_body" in data).toBe(false);
      // Diagnostic fields stay.
      expect(data.method).toBe("POST");
      expect(data.status_code).toBe(200);
    });

    it("strips query string from breadcrumb URLs but preserves the path", () => {
      const event: SentryEvent = {
        breadcrumbs: [
          {
            category: "http",
            data: { url: "https://api.example.com/v1/chat?token=abc&user=42" },
          },
          {
            category: "fetch",
            data: { url: "https://api.example.com/v1/workouts" },
          },
        ],
      };

      const result = scrubSentryEvent(event);

      expect(result.breadcrumbs?.[0]?.data?.url).toBe("https://api.example.com/v1/chat?[redacted]");
      // No query string → URL unchanged.
      expect(result.breadcrumbs?.[1]?.data?.url).toBe("https://api.example.com/v1/workouts");
    });

    it("leaves breadcrumbs without a data object alone", () => {
      const event: SentryEvent = {
        breadcrumbs: [
          { category: "console", message: "hello" },
          // @ts-expect-error — deliberately malformed to exercise the guard
          { category: "ui.click", data: null },
        ],
      };

      expect(() => scrubSentryEvent(event)).not.toThrow();
    });
  });

  describe("contexts (C3)", () => {
    it("drops contexts.request and contexts.response but keeps other contexts", () => {
      const event: SentryEvent = {
        contexts: {
          request: { headers: { authorization: "Bearer secret" }, body: "..." },
          response: { body: "..." },
          runtime: { name: "node", version: "20.0.0" },
          os: { name: "linux" },
        },
      };

      const result = scrubSentryEvent(event);

      expect(result.contexts?.request).toBeUndefined();
      expect(result.contexts?.response).toBeUndefined();
      expect(result.contexts?.runtime).toEqual({ name: "node", version: "20.0.0" });
      expect(result.contexts?.os).toEqual({ name: "linux" });
    });
  });

  it("returns the event reference for chainable usage", () => {
    const event: SentryEvent = { message: "hello" };
    expect(scrubSentryEvent(event)).toBe(event);
  });

  it("is safe on an empty event", () => {
    expect(() => scrubSentryEvent({})).not.toThrow();
  });
});

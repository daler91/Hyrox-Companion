import type { Event as SentryEvent } from "@sentry/node";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "../env";
import { logger } from "../logger";
import {
  configureObservability,
  registerProcessErrorHandlers,
  scrubSentryEvent,
} from "./observability";

vi.mock("../env", () => ({
  env: {
    SENTRY_DSN: "https://test@sentry.io/123",
    NODE_ENV: "test",
  },
}));

vi.mock("../logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
  SENSITIVE_REQUEST_HEADERS: [
    "authorization",
    "cookie",
    "x-csrf-token",
    "x-idempotency-key",
    "x-cron-secret",
    "x-internal-analytics-secret",
  ],
}));

describe("scrubSentryEvent", () => {

  it("handles a deeply nested event with multiple fields to scrub simultaneously", () => {
    const complexEvent = {
      request: {
        data: { secret: "value" },
        query_string: "key=val",
        cookies: "sess=123",
        headers: { "x-internal-analytics-secret": "123", "user-agent": "test" }
      },
      user: {
        id: "123",
        email: "test@example.com",
        username: "test",
        ip_address: "1.2.3.4"
      },
      breadcrumbs: [
        {
          category: "fetch",
          data: {
            url: "https://example.com/api?user=1",
            body: "test body",
            payload: { data: "test" },
            request_body: "req",
            response_body: "res",
            status_code: 200
          }
        }
      ],
      contexts: {
        request: { body: "test" },
        response: { body: "test" },
        os: { name: "macOS" }
      }
    };

    const result = scrubSentryEvent(complexEvent as any);

    expect(result.request?.data).toBeUndefined();
    expect(result.request?.query_string).toBeUndefined();
    expect(result.request?.cookies).toBeUndefined();
    expect(result.request?.headers).toEqual({ "user-agent": "test" });

    expect(result.user).toEqual({ id: "123" });

    expect(result.breadcrumbs?.[0]?.data).toEqual({
      url: "https://example.com/api?[redacted]",
      status_code: 200
    });

    expect(result.contexts?.request).toBeUndefined();
    expect(result.contexts?.response).toBeUndefined();
    expect(result.contexts?.os).toEqual({ name: "macOS" });
  });

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

  it("handles request with no headers", () => {
    const event: SentryEvent = {
      request: {
        data: "some data",
      },
    };

    const result = scrubSentryEvent(event);

    expect(result.request?.data).toBeUndefined();
    expect(result.request?.headers).toBeUndefined();
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

    it("handles non-string urls in breadcrumbs", () => {
      const event: SentryEvent = {
        breadcrumbs: [
          {
            category: "http",
            data: { url: 12345 },
          },
        ],
      };

      const result = scrubSentryEvent(event);
      expect(result.breadcrumbs?.[0]?.data?.url).toBe(12345);
    });

    it("leaves breadcrumbs without a data object alone", () => {
      const event: SentryEvent = {
        breadcrumbs: [
          { category: "console", message: "hello" },
          // @ts-expect-error — deliberately malformed to exercise the guard
          { category: "ui.click", data: null },
          // @ts-expect-error — deliberately malformed to exercise the guard
          undefined,
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

describe("configureObservability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("warns when SENTRY_DSN is not set in production", () => {
    env.SENTRY_DSN = "";
    env.NODE_ENV = "production";
    configureObservability();
    expect(logger.warn).toHaveBeenCalledWith(
      { context: "sentry" },
      "SENTRY_DSN not set — error reports disabled"
    );
  });

  it("infos when SENTRY_DSN is not set in development", () => {
    env.SENTRY_DSN = "";
    env.NODE_ENV = "development";
    configureObservability();
    expect(logger.info).toHaveBeenCalledWith(
      { context: "sentry" },
      "SENTRY_DSN not set — error reports disabled"
    );
  });

  it("initializes Sentry when SENTRY_DSN is present", () => {
    env.SENTRY_DSN = "https://test@sentry.io/123";
    env.NODE_ENV = "production";

    const initMock = vi.fn();
    const getClientMock = vi.fn().mockReturnValue({});

    configureObservability({ init: initMock, getClient: getClientMock });

    expect(initMock).toHaveBeenCalledWith(expect.objectContaining({
      dsn: "https://test@sentry.io/123",
      environment: "production",
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
    }));

    expect(logger.info).toHaveBeenCalledWith(
      { context: "sentry", clientReady: true },
      "Sentry error reporting initialised"
    );
  });

  it("uses custom release when SENTRY_RELEASE is set", () => {
    env.SENTRY_DSN = "https://test@sentry.io/123";
    process.env.SENTRY_RELEASE = "test-release";

    const initMock = vi.fn();
    const getClientMock = vi.fn();

    configureObservability({ init: initMock, getClient: getClientMock });

    expect(initMock).toHaveBeenCalledWith(expect.objectContaining({
      release: "test-release",
    }));

    delete process.env.SENTRY_RELEASE;
  });

  it("falls back to npm_package_version when SENTRY_RELEASE is not set", () => {
    env.SENTRY_DSN = "https://test@sentry.io/123";
    process.env.npm_package_version = "1.0.0";

    const initMock = vi.fn();
    const getClientMock = vi.fn();

    configureObservability({ init: initMock, getClient: getClientMock });

    expect(initMock).toHaveBeenCalledWith(expect.objectContaining({
      release: "fitai-coach@1.0.0",
    }));

    delete process.env.npm_package_version;
  });
});

describe("registerProcessErrorHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles uncaught exceptions", async () => {
    let uncaughtCb: (err: Error) => void = () => {};
    const onUncaught = vi.fn((cb) => { uncaughtCb = cb; });
    const onUnhandled = vi.fn();
    const setStartupError = vi.fn();
    const captureException = vi.fn();
    const flush = vi.fn().mockResolvedValue(true);
    const exit = vi.fn();

    registerProcessErrorHandlers({
      onUncaught,
      onUnhandled,
      setStartupError,
      captureException,
      flush,
      exit,
    });

    const error = new Error("test error");
    uncaughtCb(error);

    expect(logger.fatal).toHaveBeenCalledWith({ err: error }, "Uncaught exception in server process");
    expect(setStartupError).toHaveBeenCalledWith("uncaught_exception: test error");
    expect(captureException).toHaveBeenCalledWith(error);

    // Wait for the async flushThenExit to complete
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(flush).toHaveBeenCalledWith(2000);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("handles unhandled rejections", async () => {
    let unhandledCb: (reason: unknown) => void = () => {};
    const onUncaught = vi.fn();
    const onUnhandled = vi.fn((cb) => { unhandledCb = cb; });
    const setStartupError = vi.fn();
    const captureException = vi.fn();
    const flush = vi.fn().mockRejectedValue(new Error("flush failed"));
    const exit = vi.fn();

    registerProcessErrorHandlers({
      onUncaught,
      onUnhandled,
      setStartupError,
      captureException,
      flush,
      exit,
    });

    const error = new Error("test rejection");
    unhandledCb(error);

    expect(logger.fatal).toHaveBeenCalledWith({ err: error }, "Unhandled rejection in server process");
    expect(setStartupError).toHaveBeenCalledWith("unhandled_rejection: test rejection");
    expect(captureException).toHaveBeenCalledWith(error);

    // Wait for the async flushThenExit to complete
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(flush).toHaveBeenCalledWith(2000);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("handles string unhandled rejections", async () => {
    let unhandledCb: (reason: unknown) => void = () => {};
    const onUncaught = vi.fn();
    const onUnhandled = vi.fn((cb) => { unhandledCb = cb; });
    const setStartupError = vi.fn();
    const captureException = vi.fn();
    const flush = vi.fn().mockResolvedValue(true);
    const exit = vi.fn();

    registerProcessErrorHandlers({
      onUncaught,
      onUnhandled,
      setStartupError,
      captureException,
      flush,
      exit,
    });

    unhandledCb("just a string");

    expect(setStartupError).toHaveBeenCalledWith("unhandled_rejection: just a string");

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(exit).toHaveBeenCalledWith(1);
  });
});

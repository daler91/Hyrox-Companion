import { describe, expect, it } from "vitest";

import { classifyAiError, ErrorCode, isDatabaseError, isLikelyAiProviderFailure, shouldReportToSentry } from "./errors";

describe("isLikelyAiProviderFailure", () => {
  it.each([
    "Gemini request failed",
    "google.genai: internal",
    "The AI coach is busy",
    "Resource exhausted (quota)",
    "429 Too Many Requests",
    "rate limit exceeded",
    "Service unavailable",
    "503 upstream",
    "deadline exceeded",
    "request timed out",
    "model overloaded",
  ])("recognises %p as an AI provider failure", (message) => {
    expect(isLikelyAiProviderFailure(new Error(message))).toBe(true);
  });

  it.each([
    "duplicate key value violates unique constraint",
    "connection refused",
    "Plan day not found",
    "",
  ])("does not treat %p as an AI provider failure", (message) => {
    expect(isLikelyAiProviderFailure(new Error(message))).toBe(false);
  });

  it.each([
    ["a statement timeout", { code: "57014", severity: "ERROR", message: "canceling statement due to statement timeout" }],
    ["a deadlock", { code: "40P01", severity: "ERROR", message: "deadlock detected" }],
    ["a pool connect timeout wrapped as a cause", { message: "query failed", cause: { code: "57P01", severity: "FATAL", message: "timeout exceeded when trying to connect" } }],
  ])("does not treat %s as an AI provider failure even though its text says timeout", (_label, err) => {
    expect(isDatabaseError(err)).toBe(true);
    expect(isLikelyAiProviderFailure(err)).toBe(false);
  });

  it("does not mistake a Node errno for a database error", () => {
    expect(isDatabaseError({ code: "EPIPE", message: "broken pipe" })).toBe(false);
    expect(isDatabaseError({ code: "ECONNRESET" })).toBe(false);
  });

  it.each(["activity 84295 could not be fetched", "wrote 5030 bytes", "row 4000 rejected"])(
    "does not read the digits inside %p as an HTTP status",
    (message) => {
      expect(isLikelyAiProviderFailure(new Error(message))).toBe(false);
      expect(classifyAiError(new Error(message)).code).toBe(ErrorCode.AI_ERROR);
    },
  );

  it("accepts strings and arbitrary throws", () => {
    expect(isLikelyAiProviderFailure("gemini exploded")).toBe(true);
    expect(isLikelyAiProviderFailure({ reason: "quota" })).toBe(true);
    expect(isLikelyAiProviderFailure(null)).toBe(false);
  });

  it("agrees with classifyAiError on every message classifyAiError treats as quota or outage", () => {
    for (const message of ["429", "rate limit", "resource exhausted", "unavailable", "504", "timeout"]) {
      const classified = classifyAiError(new Error(message));
      expect(classified.code).not.toBe(ErrorCode.AI_ERROR);
      expect(isLikelyAiProviderFailure(new Error(message))).toBe(true);
    }
  });
});

describe("classifyAiError", () => {
  it("maps quota, invalid-input and outage messages to their codes", () => {
    expect(classifyAiError(new Error("429 quota")).code).toBe(ErrorCode.AI_QUOTA_EXCEEDED);
    expect(classifyAiError(new Error("400 bad request")).code).toBe(ErrorCode.AI_INVALID_INPUT);
    expect(classifyAiError(new Error("model overloaded")).code).toBe(ErrorCode.AI_UNAVAILABLE);
    expect(classifyAiError(new Error("something else")).code).toBe(ErrorCode.AI_ERROR);
  });
});

describe("shouldReportToSentry", () => {
  /**
   * The global handler used to call `Sentry.captureException` for every error
   * it saw. `beforeSend` scrubs PII but does not filter by status and there is
   * no `ignoreErrors`, so a zod rejection, an unauthenticated request, a stale
   * id and an idempotency conflict each became an event — the API correctly
   * refusing a request, reported as a fault.
   */

  it("reports server faults", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(shouldReportToSentry(status)).toBe(true);
    }
  });

  it("does not report the client-fault 4xx that made up the noise", () => {
    // 400 zod, 401 unauthenticated, 403 forbidden, 404 stale id,
    // 409 idempotency conflict, 413 oversized body, 422 unprocessable.
    for (const status of [400, 401, 403, 404, 409, 413, 422]) {
      expect(shouldReportToSentry(status)).toBe(false);
    }
  });

  it("keeps 429, the one 4xx worth paging on", () => {
    // A single rate-limited request is noise; a sustained stream of them is a
    // runaway client, and nothing else surfaces that.
    expect(shouldReportToSentry(429)).toBe(true);
  });

  it("stays quiet for a non-error status that somehow reached the handler", () => {
    // Nothing should throw with one of these, but if it does, the wrong status
    // is the bug rather than the error, and a Sentry event would not say so.
    expect(shouldReportToSentry(200)).toBe(false);
    expect(shouldReportToSentry(302)).toBe(false);
  });
});

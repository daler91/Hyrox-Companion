import { describe, expect, it } from "vitest";

import { extractApiErrorCode, extractErrorObjectCode, parseApiError } from "./apiError";
import { AiBudgetExceededError, RateLimitError } from "./queryClient";

// CL34 (CODEBASE_ANALYSIS_2026-10-03): a shared reading of apiRequest's
// `${status}: ${body}` message, in place of a private parser per caller.
describe("parseApiError", () => {
  it("reads the status and the code from a JSON body", () => {
    const error = new Error('400: {"error":"MAF setup is incomplete","code":"MAF_SETUP_REQUIRED"}');

    expect(parseApiError(error)).toEqual({ status: 400, code: "MAF_SETUP_REQUIRED" });
  });

  it("reads a JSON body however it is spaced", () => {
    expect(parseApiError(new Error('409:{"code":"IDEMPOTENT_REQUEST_IN_PROGRESS"}'))).toEqual({
      status: 409,
      code: "IDEMPOTENT_REQUEST_IN_PROGRESS",
    });
    expect(parseApiError(new Error('403:  \n {"code":"EBADCSRFTOKEN"}'))).toEqual({
      status: 403,
      code: "EBADCSRFTOKEN",
    });
  });

  // A proxy's error page or a bare status text is not JSON: the status still
  // counts, and the code is simply absent.
  it.each([
    ["a status text", "502: Bad Gateway", 502],
    // A proxy's page, as test input; `safe` tells Codacy's XSS rule that this
    // literal is data, not markup the code renders.
    ["an HTML page", /* safe */ "504: <html><body>Gateway Timeout</body></html>", 504],
    ["an empty body", "500: ", 500],
    ["a body cut short", '400: {"code":"VALIDATION', 400],
  ])("keeps the status of %s, with no code", (_name, message, status) => {
    expect(parseApiError(new Error(message))).toEqual({ status, code: null });
  });

  it.each([
    ["no code", '404: {"error":"Plan day not found"}'],
    ["a code that is not a string", '400: {"code":42}'],
    ["a JSON null", "400: null"],
    ["a JSON string", '400: "MAF_SETUP_REQUIRED"'],
    ["a JSON array", '400: [{"code":"MAF_SETUP_REQUIRED"}]'],
  ])("has no code for a body with %s", (_name, message) => {
    expect(parseApiError(new Error(message))?.code).toBeNull();
  });

  // Only an apiRequest failure has the prefix: no response at all, a timeout,
  // a rate limit or a failed CSRF token fetch says nothing about the status.
  it.each([
    ["a network failure", new TypeError("Failed to fetch")],
    ["a CSRF token fetch", new Error("Failed to fetch CSRF token: 500")],
    ["a rate limit", new RateLimitError('{"error":"Too many requests","code":"RATE_LIMITED"}', 30)],
    ["the AI budget", new AiBudgetExceededError("Daily AI usage limit reached.", 210, 200)],
    ["a four-digit head", new Error('5000: {"code":"X"}')],
    ["a head that is not a number", new Error('abc: {"code":"X"}')],
    ["a bare status", new Error("500")],
    ["an empty message", new Error("")],
  ])("is null for %s", (_name, error) => {
    expect(parseApiError(error)).toBeNull();
  });

  it.each([
    ["a string", '400: {"code":"MAF_SETUP_REQUIRED"}'],
    ["a plain object", { message: '400: {"code":"MAF_SETUP_REQUIRED"}' }],
    ["null", null],
    ["undefined", undefined],
  ])("is null for %s, which apiRequest never throws", (_name, error) => {
    expect(parseApiError(error)).toBeNull();
  });
});

// CH-errorCode (REFACTORING_REVIEW 2026-09-23): one reading of an error's code
// for the workout save and the plan-day parse.
describe("extractErrorObjectCode", () => {
  it.each([
    ["its own code", { code: "STRUCTURED_ROWS_REQUIRED" }],
    ["payload.code", { payload: { code: "STRUCTURED_ROWS_REQUIRED" } }],
    ["response.data.code", { response: { data: { code: "STRUCTURED_ROWS_REQUIRED" } } }],
  ])("reads %s", (_name, error) => {
    expect(extractErrorObjectCode(error)).toBe("STRUCTURED_ROWS_REQUIRED");
  });

  it("prefers its own code, then the payload, then the response", () => {
    expect(extractErrorObjectCode({ code: "A", payload: { code: "B" }, response: { data: { code: "C" } } })).toBe("A");
    expect(extractErrorObjectCode({ payload: { code: "B" }, response: { data: { code: "C" } } })).toBe("B");
  });

  it("does not read the message", () => {
    expect(extractErrorObjectCode(new Error('400: {"code":"MAF_SETUP_REQUIRED"}'))).toBeNull();
  });

  it.each([
    ["a DOMException's numeric code", new DOMException("Request timed out", "TimeoutError")],
    ["a null response", { response: null }],
    ["a string", "STRUCTURED_ROWS_REQUIRED"],
    ["null", null],
  ])("is null for %s", (_name, error) => {
    expect(extractErrorObjectCode(error)).toBeNull();
  });
});

describe("extractApiErrorCode", () => {
  it("reads the code the error carries before the message", () => {
    const error = Object.assign(new Error('400: {"code":"FROM_MESSAGE"}'), { code: "FROM_OBJECT" });

    expect(extractApiErrorCode(error)).toBe("FROM_OBJECT");
  });

  it("falls back to apiRequest's message", () => {
    expect(extractApiErrorCode(new Error('400: {"code":"STRUCTURED_ROWS_REQUIRED"}'))).toBe("STRUCTURED_ROWS_REQUIRED");
  });

  it("is null when neither has one", () => {
    expect(extractApiErrorCode(new Error("500: Internal Server Error"))).toBeNull();
    expect(extractApiErrorCode(new TypeError("Failed to fetch"))).toBeNull();
  });
});

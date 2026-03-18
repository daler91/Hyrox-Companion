import { describe, it, expect, vi } from "vitest";
import { isRetryableError, retryWithBackoff } from "./client";

describe("isRetryableError", () => {
  it("returns true for 429 rate limit", () => {
    expect(isRetryableError(new Error("Request failed with status 429"))).toBe(true);
  });

  it("returns true for 'rate limit' message", () => {
    expect(isRetryableError(new Error("rate limit exceeded"))).toBe(true);
  });

  it("returns true for 500 server error", () => {
    expect(isRetryableError(new Error("500 Internal Server Error"))).toBe(true);
  });

  it("returns true for 503 service unavailable", () => {
    expect(isRetryableError(new Error("503 Service Unavailable"))).toBe(true);
  });

  it("returns true for 502 bad gateway", () => {
    expect(isRetryableError(new Error("502 Bad Gateway"))).toBe(true);
  });

  it("returns true for 504 gateway timeout", () => {
    expect(isRetryableError(new Error("504 Gateway Timeout"))).toBe(true);
  });

  it("returns true for network errors", () => {
    expect(isRetryableError(new Error("network error"))).toBe(true);
    expect(isRetryableError(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryableError(new Error("request timeout"))).toBe(true);
    expect(isRetryableError(new Error("fetch failed"))).toBe(true);
  });

  it("returns true for case-insensitive matches", () => {
    expect(isRetryableError(new Error("RATE LIMIT"))).toBe(true);
    expect(isRetryableError(new Error("INTERNAL SERVER ERROR"))).toBe(true);
  });

  it("returns false for 400 bad request", () => {
    expect(isRetryableError(new Error("400 Bad Request"))).toBe(false);
  });

  it("returns true for structured error objects with status code", () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
    expect(isRetryableError({ status: 500 })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
  });

  it("returns true for structured error objects with code property", () => {
    expect(isRetryableError({ code: 429 })).toBe(true);
    expect(isRetryableError({ code: 500 })).toBe(true);
  });

  it("returns false for non-Error and non-retryable objects", () => {
    expect(isRetryableError("string error")).toBe(false);
    expect(isRetryableError(42)).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
    expect(isRetryableError({ status: 400 })).toBe(false);
    expect(isRetryableError({ message: "something else" })).toBe(false);
  });

  it("returns false for unrelated error messages", () => {
    expect(isRetryableError(new Error("Invalid JSON"))).toBe(false);
    expect(isRetryableError(new Error("Missing required field"))).toBe(false);
  });
});

describe("retryWithBackoff", () => {
  it("succeeds on first try without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await retryWithBackoff(fn, "test", 2, 1);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable error and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("503 Service Unavailable"))
      .mockResolvedValue("recovered");
    const result = await retryWithBackoff(fn, "test", 2, 1);
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry on non-retryable error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("400 Bad Request"));
    await expect(retryWithBackoff(fn, "test", 2, 1)).rejects.toThrow("400 Bad Request");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting max retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("503 Service Unavailable"));
    await expect(retryWithBackoff(fn, "test", 2, 1)).rejects.toThrow("503 Service Unavailable");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

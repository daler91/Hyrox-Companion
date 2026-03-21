import { describe, it, expect, vi } from "vitest";
import { isRetryableError, retryWithBackoff, truncate } from "./client";

describe("isRetryableError", () => {
  it.each([
    ["Request failed with status 429", true],
    ["rate limit exceeded", true],
    ["500 Internal Server Error", true],
    ["503 Service Unavailable", true],
    ["network error", true],
    ["ECONNRESET", true],
    ["request timeout", true],
    ["fetch failed", true],
    ["400 Bad Request", false],
    ["Invalid JSON", false],
    ["Missing required field", false],
  ])("returns %2$p when error message is %1$p", (msg, expected) => {
    expect(isRetryableError(new Error(msg))).toBe(expected);
  });

  it("returns false for non-Error values", () => {
    expect(isRetryableError("string error")).toBe(false);
    expect(isRetryableError(42)).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
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

describe("truncate", () => {
  it("does not truncate short strings", () => {
    const text = "Hello world";
    expect(truncate(text, 20)).toBe(text);
  });

  it("truncates long strings at default limit", () => {
    const text = "a".repeat(501);
    const expected = "a".repeat(500) + "...";
    expect(truncate(text)).toBe(expected);
  });

  it("truncates long strings at custom limit", () => {
    const text = "Hello world";
    expect(truncate(text, 5)).toBe("Hello...");
  });

  it("handles exact length strings correctly", () => {
    const text = "a".repeat(500);
    expect(truncate(text)).toBe(text);
  });
});

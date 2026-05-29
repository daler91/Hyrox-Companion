import { describe, expect, it, vi } from "vitest";

import { isTransientNetworkError, parseRetryAfter, RetryableHttpError, retryWithJitter } from "./httpRetry";

// Zero delays keep the retry loop instant under test.
const fast = { retries: 2, minDelayMs: 0, maxDelayMs: 0 } as const;

function named(message: string, name: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe("isTransientNetworkError", () => {
  it("flags AbortSignal.timeout's TimeoutError", () => {
    expect(isTransientNetworkError(named("timed out", "TimeoutError"))).toBe(true);
  });

  it("flags errno codes directly or via cause", () => {
    expect(isTransientNetworkError(Object.assign(new Error(), { code: "ECONNRESET" }))).toBe(true);
    expect(isTransientNetworkError(new TypeError("fetch failed", { cause: { code: "ETIMEDOUT" } }))).toBe(true);
    expect(
      isTransientNetworkError(new TypeError("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } })),
    ).toBe(true);
  });

  it("does NOT flag a deliberate AbortError (client cancel / disconnect)", () => {
    expect(isTransientNetworkError(named("aborted", "AbortError"))).toBe(false);
  });

  it("does NOT flag generic errors or non-objects", () => {
    expect(isTransientNetworkError(new Error("boom"))).toBe(false);
    expect(isTransientNetworkError(Object.assign(new Error(), { code: "EACCES" }))).toBe(false);
    expect(isTransientNetworkError(null)).toBe(false);
    expect(isTransientNetworkError("nope")).toBe(false);
  });
});

describe("retryWithJitter", () => {
  it("returns on first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(retryWithJitter(fn, fast)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a RetryableHttpError then succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new RetryableHttpError(503)).mockResolvedValue("ok");
    await expect(retryWithJitter(fn, fast)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries transient network/timeout errors up to the limit then rethrows", async () => {
    const timeout = named("timed out", "TimeoutError");
    const fn = vi.fn().mockRejectedValue(timeout);
    await expect(retryWithJitter(fn, fast)).rejects.toBe(timeout);
    expect(fn).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
  });

  it("does NOT retry a deliberate AbortError", async () => {
    const abort = named("aborted", "AbortError");
    const fn = vi.fn().mockRejectedValue(abort);
    await expect(retryWithJitter(fn, fast)).rejects.toBe(abort);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry non-transient errors (e.g. 4xx / generic)", async () => {
    const err = new Error("400 Bad Request");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(retryWithJitter(fn, fast)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("parseRetryAfter", () => {
  it("parses a seconds value into milliseconds", () => {
    expect(parseRetryAfter("2")).toBe(2000);
  });

  it("returns null for missing or unparseable headers", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("not-a-date")).toBeNull();
  });
});

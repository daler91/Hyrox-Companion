import crypto from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { safeEqualDigest } from "./safeEqualDigest";

describe("safeEqualDigest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is true for equal strings, including empty ones", () => {
    expect(safeEqualDigest("cron-secret", "cron-secret")).toBe(true);
    expect(safeEqualDigest("", "")).toBe(true);
  });

  it("is false for different strings of the same length", () => {
    expect(safeEqualDigest("abcdef", "abcdeg")).toBe(false);
  });

  it("is false, rather than throwing, for strings of different lengths", () => {
    expect(() => safeEqualDigest("short", "a much longer value")).not.toThrow();
    expect(safeEqualDigest("short", "a much longer value")).toBe(false);
    expect(safeEqualDigest("", "x")).toBe(false);
  });

  it("compares UTF-8 text, not UTF-16 code units", () => {
    expect(safeEqualDigest("café", "café")).toBe(true);
    // Same characters, different normalisation: different bytes.
    expect(safeEqualDigest("café", "café")).toBe(false);
  });

  it("compares two 32-byte SHA-256 digests in constant time", () => {
    const spy = vi.spyOn(crypto, "timingSafeEqual");

    safeEqualDigest("provided", "a longer expected value");

    expect(spy).toHaveBeenCalledTimes(1);
    const [a, b] = spy.mock.calls[0];
    expect(a).toEqual(crypto.createHash("sha256").update("provided").digest());
    expect(b).toEqual(crypto.createHash("sha256").update("a longer expected value").digest());
    expect(a.byteLength).toBe(32);
    expect(b.byteLength).toBe(32);
  });
});

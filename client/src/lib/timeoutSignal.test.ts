import { afterEach, describe, expect, it, vi } from "vitest";

import { timeoutSignal } from "./timeoutSignal";

describe("timeoutSignal", () => {
  const nativeTimeout = AbortSignal.timeout;

  afterEach(() => {
    AbortSignal.timeout = nativeTimeout;
    vi.useRealTimers();
  });

  it("returns an AbortSignal (native path)", () => {
    expect(timeoutSignal(1000)).toBeInstanceOf(AbortSignal);
  });

  it("falls back to AbortController when AbortSignal.timeout is unavailable", () => {
    vi.useFakeTimers();
    // @ts-expect-error force the unsupported-browser (Safari < 16) path
    AbortSignal.timeout = undefined;

    const signal = timeoutSignal(1000);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);

    vi.advanceTimersByTime(1001);
    expect(signal.aborted).toBe(true);
  });
});

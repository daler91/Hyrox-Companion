import { describe, expect, it, vi } from "vitest";

import { mapLimitedUntilFailure } from "./limitedFanOut";

/** Resolves after `ms`, or rejects with the signal's reason once it aborts. */
function waitOrAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("cancelled"));
    });
  });
}

describe("mapLimitedUntilFailure", () => {
  it("returns every result in item order, at most `concurrency` running at once", async () => {
    const flight = { active: 0, peak: 0 };
    const step = vi.fn(async (item: number, signal: AbortSignal) => {
      flight.active += 1;
      flight.peak = Math.max(flight.peak, flight.active);
      // Later items finish first.
      await waitOrAbort(2 * (6 - item), signal);
      flight.active -= 1;
      return item * 10;
    });

    const results = await mapLimitedUntilFailure([1, 2, 3, 4, 5], 2, step);

    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(flight.peak).toBe(2);
    expect(step).toHaveBeenCalledTimes(5);
  });

  it("rejects with the first failure, cancels the steps running and starts no more (PF15)", async () => {
    const failure = new Error("chunk 1 failed");
    const signals: AbortSignal[] = [];
    const step = vi.fn(async (item: number, signal: AbortSignal) => {
      signals.push(signal);
      if (item === 1) throw failure;
      await waitOrAbort(1000, signal);
      return item;
    });

    await expect(mapLimitedUntilFailure([1, 2, 3, 4, 5, 6], 3, step)).rejects.toBe(failure);
    // Let the cancelled and queued steps settle.
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });

    // Items 1-3 were running together; 4-6 never got as far as the step.
    expect(step.mock.calls.map((call) => call[0])).toEqual([1, 2, 3]);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("starts nothing once the caller's own signal has aborted", async () => {
    const caller = new AbortController();
    caller.abort(new Error("shutting down"));
    const step = vi.fn((item: number) => Promise.resolve(item));

    await expect(mapLimitedUntilFailure([1, 2], 2, step, caller.signal)).rejects.toThrow(
      "shutting down",
    );
    expect(step).not.toHaveBeenCalled();
  });
});

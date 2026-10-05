import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { retryWithJitter } from "../../utils/httpRetry";
import { PROVIDER_DEADLINE_MS, ProviderDeadlineError, startProviderDeadline } from "./utils";

vi.mock("../../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

// D13 (CODEBASE_ANALYSIS_2026-10-03): one deadline for a request's provider calls.
describe("startProviderDeadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("settles with the work when it answers in time", async () => {
    const deadline = startProviderDeadline();
    await expect(deadline.within(Promise.resolve("ok"))).resolves.toBe("ok");
    deadline.clear();
  });

  it("rejects work still running at the deadline and aborts its signal", async () => {
    const deadline = startProviderDeadline();
    const pending = deadline.within(
      new Promise(() => {
        /* never settles */
      }),
    );
    const outcome = expect(pending).rejects.toBeInstanceOf(ProviderDeadlineError);

    await vi.advanceTimersByTimeAsync(PROVIDER_DEADLINE_MS);

    await outcome;
    expect(deadline.signal.aborted).toBe(true);
  });

  it("stops a provider's retries at the deadline instead of letting them compound", async () => {
    const deadline = startProviderDeadline();
    let attempts = 0;
    // Each attempt times out after 8 s (a transient TimeoutError, which is
    // retried) unless the deadline aborts it first.
    const attempt = () =>
      new Promise<never>((_, reject) => {
        attempts += 1;
        const timer = setTimeout(() => {
          reject(new DOMException("timed out", "TimeoutError"));
        }, 8_000);
        deadline.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          const reason: unknown = deadline.signal.reason;
          reject(reason instanceof Error ? reason : new Error(String(reason)));
        });
      });
    const call = retryWithJitter(attempt, { retries: 2, minDelayMs: 1, maxDelayMs: 1 });
    const outcome = expect(call).rejects.toMatchObject({ name: "AbortError" });

    await vi.advanceTimersByTimeAsync(PROVIDER_DEADLINE_MS);
    await outcome;

    // The first attempt timed out and was retried; the deadline's abort is not
    // retryable, so the second attempt was the last.
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(attempts).toBe(2);
  });
});

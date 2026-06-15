import { vi } from "vitest";

/**
 * Manual mock for `server/utils/httpRetry`, loaded when a spec calls the bare
 * `vi.mock("../../utils/httpRetry")`. It keeps the real error class and the
 * transient-error classifiers, and only replaces `retryWithJitter` with a
 * delay-free loop so retry-path tests run instantly while still honoring each
 * call's `retries` and the real "is this retryable?" decision.
 */
const actual = await vi.importActual<typeof import("../httpRetry")>("../httpRetry");

export const { RetryableHttpError, isTransientNetworkError, parseRetryAfter } = actual;

export const retryWithJitter = async (
  fn: () => Promise<unknown>,
  opts?: { retries?: number },
): Promise<unknown> => {
  const retries = opts?.retries ?? 0;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable =
        err instanceof actual.RetryableHttpError || actual.isTransientNetworkError(err);
      if (!retryable || i >= retries) throw err;
    }
  }
  throw lastErr;
};

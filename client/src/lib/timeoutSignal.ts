/**
 * Returns an AbortSignal that aborts after `ms` milliseconds.
 *
 * `AbortSignal.timeout` is unsupported on Safari < 16 (which this app still
 * targets). Calling it there throws a TypeError, which — at our fetch call
 * sites — would break the request entirely instead of merely running without a
 * timeout. So we feature-detect and fall back to AbortController + setTimeout.
 */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => {
    controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
  }, ms);
  return controller.signal;
}

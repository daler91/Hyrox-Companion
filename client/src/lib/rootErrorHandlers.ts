import * as Sentry from "@sentry/react";
import type { RootOptions } from "react-dom/client";

type CaughtErrorInfo = Parameters<NonNullable<RootOptions["onCaughtError"]>>[1];

const reportCaughtError = Sentry.reactErrorHandler();

/**
 * React 19 calls `onCaughtError` for every error a boundary catches, before
 * that boundary's own `componentDidCatch`. A `Sentry.ErrorBoundary` reports the
 * error itself, with the tags it was given (a feature boundary adds `feature`),
 * so reporting it here as well sent it twice, and Sentry's duplicate filter
 * kept this untagged first copy and dropped the boundary's tagged one (tech
 * debt #56). Only an error caught by some other kind of boundary is reported
 * here.
 */
export function onCaughtError(error: unknown, errorInfo: CaughtErrorInfo): void {
  if (errorInfo.errorBoundary instanceof Sentry.ErrorBoundary) return;
  reportCaughtError(error, errorInfo);
}

/**
 * React 19 no longer re-throws render errors: uncaught ones go to
 * window.reportError and boundary-caught ones only to console.error, so Sentry
 * hooks the root callbacks to keep capturing them. Each handler does nothing
 * until Sentry.init runs (deferred behind the privacy notice, S11).
 */
export const rootErrorHandlers = {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError,
  onRecoverableError: Sentry.reactErrorHandler(),
} satisfies Pick<RootOptions, "onUncaughtError" | "onCaughtError" | "onRecoverableError">;

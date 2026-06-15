import * as Sentry from "@sentry/react";

import { isErrorReportingEnabled } from "./errorReportingConsent";
import { hasAcknowledgedPrivacyNotice, onPrivacyConsentChange } from "./privacyConsent";

// S11 — client error reporting (Sentry) is gated two ways before it sends
// anything: the per-processor opt-out (errorReportingConsent) AND
// acknowledgement of the first-load privacy notice. We defer Sentry.init until
// the notice is acknowledged so nothing is captured before the user has seen
// what's collected, matching the app's opt-in, privacy-first posture.

let started = false;

function getDsn(): string | undefined {
  return import.meta.env.VITE_SENTRY_DSN as string | undefined;
}

/** Initialize Sentry once, subject to the per-processor opt-out. Idempotent. */
function start(): void {
  if (started) return;
  const dsn = getDsn();
  if (!dsn || !isErrorReportingEnabled()) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // The Sentry Vite plugin injects SENTRY_RELEASE into the bundle at build
    // time when SENTRY_AUTH_TOKEN is configured. VITE_SENTRY_RELEASE is an
    // optional manual override; both resolve to undefined in dev/contributor
    // builds (Sentry buckets such events as releaseless, which is fine).
    release:
      (import.meta.env.VITE_SENTRY_RELEASE as string | undefined) ??
      (import.meta.env.SENTRY_RELEASE as string | undefined),
    sendDefaultPii: false,
  });
  started = true;
}

/** Stop sending events (used when the user opts out at runtime). */
function stop(): void {
  if (!started) return;
  // close() flushes and disables the client; a later start() re-inits.
  // Fire-and-forget: a failed flush on opt-out is non-actionable.
  Sentry.close().catch(() => {
    /* ignore flush failures */
  });
  started = false;
}

/**
 * Called once at boot. Inits now if the privacy notice is already acknowledged;
 * otherwise defers until it is, then unsubscribes.
 */
export function setupErrorReporting(): void {
  if (!getDsn()) return;
  if (hasAcknowledgedPrivacyNotice()) {
    start();
    return;
  }
  const unsubscribe = onPrivacyConsentChange(() => {
    if (hasAcknowledgedPrivacyNotice()) {
      start();
      unsubscribe();
    }
  });
}

/**
 * Apply a runtime opt-in (Settings toggle) immediately instead of on next
 * reload: inits Sentry once the privacy notice is acknowledged. Persisting the
 * preference is the caller's job.
 */
export function startErrorReporting(): void {
  if (hasAcknowledgedPrivacyNotice()) start();
}

/**
 * Apply a runtime opt-out (Settings toggle) immediately instead of on next
 * reload: closes the client. Persisting the preference is the caller's job.
 */
export function stopErrorReporting(): void {
  stop();
}

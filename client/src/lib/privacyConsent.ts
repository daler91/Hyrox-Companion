import { safeLocalStorage } from "./safeStorage";

// Acknowledgement state for the first-load privacy notice banner. Extracted so
// the banner and the error-reporting gate (main.tsx / errorReporting.ts) share
// one source of truth for the key + change event (S11) — no drift between
// "banner dismissed" and "OK to start Sentry".
const CONSENT_STORAGE_KEY = "fitai-privacy-consent-v1"; // gitleaks:allow — a localStorage key name, not a secret
const CONSENT_CHANGED_EVENT = "fitai:privacy-consent-changed";

// This tab's acknowledgement when storage would not keep it (blocked, private
// mode, full). The banner can't persist a dismissal there, so it asks again on
// the next load, but within this session the answer stands and Sentry may
// start. P8 (CODEBASE_ANALYSIS_2026-10-03)
let acknowledgedWithoutStorage = false;

/** True once the user has seen + acknowledged the privacy notice banner. */
export function hasAcknowledgedPrivacyNotice(): boolean {
  if (globalThis.window === undefined) return true;
  if (acknowledgedWithoutStorage) return true;
  const consent = safeLocalStorage.tryGetItem(CONSENT_STORAGE_KEY);
  // Fail closed when storage is unavailable: the banner shows and client Sentry
  // waits for it, rather than reading unreadable storage as acknowledged and
  // starting before the notice was ever seen (P8).
  return consent.ok && consent.value !== null;
}

/** Record acknowledgement of the privacy notice and notify same-tab listeners. */
export function recordPrivacyConsent(): void {
  safeLocalStorage.setItem(CONSENT_STORAGE_KEY, String(Date.now()));
  // setItem swallows storage failures, so read back to see whether it stuck.
  acknowledgedWithoutStorage = safeLocalStorage.getItem(CONSENT_STORAGE_KEY) === null;
  // The native `storage` event only fires across tabs, so dispatch a custom
  // event for our own same-tab listeners (banner self-hide, Sentry deferral).
  globalThis.window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
}

/**
 * Subscribe to privacy-notice acknowledgement changes (same-tab custom event +
 * cross-tab `storage` event). Returns an unsubscribe function.
 */
export function onPrivacyConsentChange(callback: () => void): () => void {
  if (globalThis.window === undefined) return () => {};
  globalThis.window.addEventListener(CONSENT_CHANGED_EVENT, callback);
  globalThis.window.addEventListener("storage", callback);
  return () => {
    globalThis.window.removeEventListener(CONSENT_CHANGED_EVENT, callback);
    globalThis.window.removeEventListener("storage", callback);
  };
}

/** Clears this module's in-memory acknowledgement between tests. */
export function __resetPrivacyConsentSessionForTests(): void {
  acknowledgedWithoutStorage = false;
}

import { safeLocalStorage } from "./safeStorage";

// Acknowledgement state for the first-load privacy notice banner. Extracted so
// the banner and the error-reporting gate (main.tsx / errorReporting.ts) share
// one source of truth for the key + change event (S11) — no drift between
// "banner dismissed" and "OK to start Sentry".
const CONSENT_STORAGE_KEY = "fitai-privacy-consent-v1"; // gitleaks:allow — a localStorage key name, not a secret
const CONSENT_CHANGED_EVENT = "fitai:privacy-consent-changed";

/** True once the user has seen + acknowledged the privacy notice banner. */
export function hasAcknowledgedPrivacyNotice(): boolean {
  if (globalThis.window === undefined) return true;
  const consent = safeLocalStorage.tryGetItem(CONSENT_STORAGE_KEY);
  // Fail open when storage is unavailable: the banner can't persist a dismissal
  // there either, so it treats that case as acknowledged rather than nagging.
  return !consent.ok || consent.value !== null;
}

/** Record acknowledgement of the privacy notice and notify same-tab listeners. */
export function recordPrivacyConsent(): void {
  safeLocalStorage.setItem(CONSENT_STORAGE_KEY, String(Date.now()));
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

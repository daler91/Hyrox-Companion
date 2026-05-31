import { safeLocalStorage } from "./safeStorage";

// Per-processor consent for error reporting (Sentry) — S11. Error monitoring is
// the one third-party processor the user previously could not opt out of: AI
// coaching (aiCoachEnabled) and email (notification preferences) already have
// their own toggles, but Sentry capture was unconditional. This stores a
// browser-local opt-out so a privacy-conscious user can disable client error
// reporting without affecting other users.
//
// Defaults to enabled (absence of the key) so existing behavior is preserved
// and any storage failure fails open to the current default. Read once at boot
// in main.tsx to gate Sentry.init, so a change takes effect on the next reload.
const ERROR_REPORTING_CONSENT_KEY = "fitai-error-reporting-consent-v1";
const OPTED_OUT_VALUE = "off";

export function isErrorReportingEnabled(): boolean {
  const read = safeLocalStorage.tryGetItem(ERROR_REPORTING_CONSENT_KEY);
  if (!read.ok) return true;
  return read.value !== OPTED_OUT_VALUE;
}

export function setErrorReportingEnabled(enabled: boolean): void {
  if (enabled) {
    safeLocalStorage.removeItem(ERROR_REPORTING_CONSENT_KEY);
  } else {
    safeLocalStorage.setItem(ERROR_REPORTING_CONSENT_KEY, OPTED_OUT_VALUE);
  }
}

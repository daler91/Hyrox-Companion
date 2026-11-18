import { safeLocalStorage } from "./safeStorage";

// Per-processor consent for error reporting (Sentry) — S11. Error monitoring is
// the one third-party processor the user previously could not opt out of: AI
// coaching (aiCoachEnabled) and email (notification preferences) already have
// their own toggles, but Sentry capture was unconditional. This stores a
// browser-local opt-out so a privacy-conscious user can disable client error
// reporting without affecting other users.
//
// Defaults to enabled (absence of the key) so existing behavior is preserved
// and any storage failure fails open to the current default. Read at boot to
// gate Sentry.init. The setters below only record the decision; their callers
// apply it at once: the Settings card starts or stops Sentry in place
// (startErrorReporting / stopErrorReporting), and the privacy banner's
// acknowledgement fires the event errorReporting's boot listener answers.
const ERROR_REPORTING_CONSENT_KEY = "fitai-error-reporting-consent-v1";
const OPTED_OUT_VALUE = "off";

// This tab's decision when storage would not keep it. Without it, "Decline
// analytics" in a browser with storage blocked read back as the default and
// Sentry started as soon as the notice was acknowledged.
// P8 (CODEBASE_ANALYSIS_2026-10-03)
let unsavedDecision: boolean | undefined;

/** The stored decision, or undefined when storage can't be read. */
function readSavedDecision(): boolean | undefined {
  const read = safeLocalStorage.tryGetItem(ERROR_REPORTING_CONSENT_KEY);
  if (!read.ok) return undefined;
  return read.value !== OPTED_OUT_VALUE;
}

/** Holds `enabled` in memory for the session unless storage now reflects it. */
function rememberIfUnsaved(enabled: boolean): void {
  unsavedDecision = readSavedDecision() === enabled ? undefined : enabled;
}

export function isErrorReportingEnabled(): boolean {
  return unsavedDecision ?? readSavedDecision() ?? true;
}

/** Record the opt-in (clears the opt-out). Starting Sentry is the caller's job. */
export function enableErrorReporting(): void {
  safeLocalStorage.removeItem(ERROR_REPORTING_CONSENT_KEY);
  rememberIfUnsaved(true);
}

/** Record the opt-out. Stopping Sentry is the caller's job. */
export function disableErrorReporting(): void {
  safeLocalStorage.setItem(ERROR_REPORTING_CONSENT_KEY, OPTED_OUT_VALUE);
  rememberIfUnsaved(false);
}

/** Clears this module's in-memory decision between tests. */
export function __resetErrorReportingConsentSessionForTests(): void {
  unsavedDecision = undefined;
}

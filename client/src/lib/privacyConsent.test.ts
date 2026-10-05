import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetPrivacyConsentSessionForTests,
  hasAcknowledgedPrivacyNotice,
  onPrivacyConsentChange,
  recordPrivacyConsent,
} from "./privacyConsent";

const CONSENT_STORAGE_KEY = "fitai-privacy-consent-v1";

/** A browser that refuses localStorage outright (blocked site data, hardened mode). */
function denyLocalStorage(): void {
  const deny = () => {
    throw new DOMException("Denied", "SecurityError");
  };
  vi.stubGlobal("localStorage", { getItem: vi.fn(deny), setItem: vi.fn(deny) });
}

// P8 (CODEBASE_ANALYSIS_2026-10-03): unreadable storage used to count as an
// acknowledgement, so the notice never showed and Sentry started at boot.
describe("privacyConsent", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPrivacyConsentSessionForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is unacknowledged until recorded, then persists the acknowledgement", () => {
    expect(hasAcknowledgedPrivacyNotice()).toBe(false);

    recordPrivacyConsent();

    expect(hasAcknowledgedPrivacyNotice()).toBe(true);
    expect(localStorage.getItem(CONSENT_STORAGE_KEY)).not.toBeNull();
  });

  it("treats unreadable storage as not acknowledged", () => {
    denyLocalStorage();

    expect(hasAcknowledgedPrivacyNotice()).toBe(false);
  });

  it("holds an acknowledgement storage refused for the rest of the session, and notifies listeners", () => {
    denyLocalStorage();
    const listener = vi.fn();
    const unsubscribe = onPrivacyConsentChange(listener);

    recordPrivacyConsent();
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(hasAcknowledgedPrivacyNotice()).toBe(true);
  });

  it("holds the acknowledgement when storage reads but will not write (full or private mode)", () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException("Full", "QuotaExceededError");
      }),
    });
    expect(hasAcknowledgedPrivacyNotice()).toBe(false);

    recordPrivacyConsent();

    expect(hasAcknowledgedPrivacyNotice()).toBe(true);
  });

  it("does not hold a session acknowledgement when storage kept it", () => {
    recordPrivacyConsent();
    localStorage.clear();

    expect(hasAcknowledgedPrivacyNotice()).toBe(false);
  });
});
